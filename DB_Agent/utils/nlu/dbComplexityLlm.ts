/**
 * 查询复杂度分级 L1–L9：LLM 优先；结构性 fallback 仅读 QueryPlan 槽位（不扫问句业务词）。
 */
import { z } from "zod";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { QueryPlan } from "./query_plan";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";
import { clipText } from "./text";
import { planSuggestsMultiCondition } from "../query_ir";
import { metricOverlapsFilterHint } from "./dbAnswerFormat";
import { incrementLlmCallCount } from "../llm_call_counter";

export type QueryTier = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8" | "L9";

const TierSchema = z.object({
  tier: z.enum(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9"]),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});

const SUBQUERY_MARKERS = ["高于平均", "低于平均", "从未", "从来没有", "不存在", "没有做过", "先统计", "先查", "再列出", "子查询"] as const;

function compactBlob(text: string): string {
  return String(text ?? "").replace(/\s+/g, "");
}

function blobIncludes(blob: string, parts: readonly string[]): boolean {
  return parts.some((p) => blob.includes(p));
}

function planFilterCount(plan?: QueryPlan | null): number {
  if (!plan) return 0;
  const where = plan.filters?.where?.filter(Boolean).length ?? 0;
  const slots = plan.filters?.slots?.filter((s) => s.field_hint || s.value).length ?? 0;
  return where + slots;
}

/** 筛槽指向锚点、metrics 指向另一属性 → 更像关联展开（JSON 数组/FK），不是单表条件 */
export function planLooksLikeLinkedAttribute(plan?: QueryPlan | null): boolean {
  if (!plan) return false;
  const metricCount = plan.metrics?.filter(Boolean).length ?? 0;
  if (metricCount < 1 || planFilterCount(plan) < 1) return false;
  if (metricOverlapsFilterHint(plan)) return false;
  return true;
}

function safeJsonParse(text: string): unknown {
  const s = String(text ?? "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function isDbComplexityLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("complexity");
}

/** 结构性分级：仅 QueryPlan 槽位；问句仅在 plan 缺失时作最弱兜底 */
export function inferQueryTierStructural(
  question: string,
  plan?: QueryPlan | null,
): { tier: QueryTier; confidence: number; reason: string } | null {
  if (plan) {
    const filterCount = planFilterCount(plan);
    const dimCount = plan.dimensions?.length ?? 0;
    const nameCount = plan.entities?.names?.length ?? 0;
    const locCount = plan.entities?.locations?.length ?? 0;
    const metricCount = plan.metrics?.filter(Boolean).length ?? 0;
    const joinHint = plan.data_domain === "person_health" || nameCount > 0;
    const linkedAttr = planLooksLikeLinkedAttribute(plan);

    if (plan.intent === "comparison") {
      return { tier: "L6", confidence: 0.76, reason: "plan_comparison" };
    }
    if (plan.intent === "trend") {
      if (filterCount >= 1 || locCount >= 1) {
        return { tier: "L5", confidence: 0.74, reason: "plan_trend_filtered" };
      }
      return { tier: "L4", confidence: 0.72, reason: "plan_trend" };
    }
    // 关联属性（筛锚点 ≠ 目标 metrics）：JSON/FK 展开，属多表关联而非「单表多条件」
    if (linkedAttr && (plan.intent === "aggregation" || plan.intent === "detail" || !plan.intent)) {
      if (filterCount >= 2 || dimCount >= 1) {
        return { tier: "L5", confidence: 0.78, reason: "plan_linked_attribute_multi" };
      }
      return { tier: "L3", confidence: 0.76, reason: "plan_linked_attribute_join" };
    }
    if (plan.intent === "detail") {
      if (filterCount >= 2 || (filterCount >= 1 && joinHint)) {
        return { tier: "L5", confidence: 0.74, reason: "plan_detail_join" };
      }
      if (filterCount >= 1) {
        return { tier: "L2", confidence: 0.7, reason: "plan_detail_filtered" };
      }
      if (joinHint) {
        return { tier: "L3", confidence: 0.68, reason: "plan_detail_join_hint" };
      }
      return { tier: "L1", confidence: 0.66, reason: "plan_detail" };
    }
    if (plan.intent === "aggregation") {
      if (dimCount >= 1 && (filterCount >= 1 || locCount >= 1)) {
        return { tier: "L5", confidence: 0.76, reason: "plan_filtered_aggregation" };
      }
      if (dimCount >= 1) {
        return { tier: "L4", confidence: 0.72, reason: "plan_distribution" };
      }
      if (filterCount >= 1 && metricCount > 0) {
        return { tier: "L2", confidence: 0.7, reason: "plan_filtered_scalar" };
      }
      if (metricCount > 0) {
        return { tier: "L4", confidence: 0.65, reason: "plan_aggregation" };
      }
    }
    if (planSuggestsMultiCondition(plan)) {
      return { tier: "L2", confidence: 0.64, reason: "plan_multi_filter" };
    }
    if (plan.intent === "schema_help") {
      return { tier: "L1", confidence: 0.8, reason: "plan_schema" };
    }
  }

  const blob = compactBlob(question);
  if (!blob || blob.length < 2) return null;
  if (blobIncludes(blob, SUBQUERY_MARKERS)) {
    return { tier: "L7", confidence: 0.7, reason: "question_subquery_fallback" };
  }
  return { tier: "L3", confidence: 0.52, reason: "question_fallback" };
}

export async function inferQueryTierByLlm(
  model: BaseLanguageModel | null,
  question: string,
  plan?: QueryPlan | null,
): Promise<{ tier: QueryTier; confidence: number; reason: string } | null> {
  if (!model) return null;
  const q = String(question ?? "").trim();
  if (!q) return null;
  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是 Text-to-SQL 复杂度分级器。输出 JSON：tier（L1-L9）、confidence（0-1）、reason（简短中文）。",
          "L1 简单明细；L2 单表多条件；L3 两表 JOIN / JSON 数组 ID 展开关联；L4 聚合统计；L5 多条件+JOIN；",
          "L6 对比/TopN；L7 子查询/多步；L8 续问（单句难判时用 L3-L5）；L9 语义模糊需澄清。",
          "示例：按课程名称筛后查绑定题库名称（arr_*_id JSON 数组或多选关联展开）→ L3 或 L5，勿标 L2 单表多条件。",
          "筛选字段与目标属性不同（如筛课程名称、取题库名称）通常不是 L2。",
          "只输出 JSON，无 Markdown。",
        ].join("\n"),
      ],
      [
        "human",
        `问题：${clipText(q, 400)}\n计划摘要：${clipText(JSON.stringify(plan ?? {}), 400)}`,
      ],
    ]);
    const text =
      typeof (res as { content?: string })?.content === "string"
        ? String((res as { content?: string }).content ?? "")
        : JSON.stringify((res as { content?: unknown })?.content ?? "");
    const parsed = TierSchema.safeParse(safeJsonParse(text));
    if (!parsed.success) return null;
    return {
      tier: parsed.data.tier,
      confidence: parsed.data.confidence ?? 0.65,
      reason: String(parsed.data.reason ?? "llm"),
    };
  } catch {
    return null;
  }
}

export async function resolveQueryTier(
  model: BaseLanguageModel | null,
  question: string,
  plan?: QueryPlan | null,
): Promise<{ tier: QueryTier; source: "structural" | "llm" | "default"; reason: string }> {
  const structural = inferQueryTierStructural(question, plan);
  // 关联属性：结构信号优先于可能误判成 L2 的 LLM
  if (structural && planLooksLikeLinkedAttribute(plan) && (structural.tier === "L3" || structural.tier === "L5")) {
    if (isDbComplexityLlmEnabled() && model) {
      const llm = await inferQueryTierByLlm(model, question, plan);
      if (llm && (llm.confidence ?? 0) >= 0.55 && llm.tier !== "L1" && llm.tier !== "L2") {
        return { tier: llm.tier, source: "llm", reason: llm.reason };
      }
    }
    return { tier: structural.tier, source: "structural", reason: structural.reason };
  }
  if (isDbComplexityLlmEnabled() && model) {
    const llm = await inferQueryTierByLlm(model, question, plan);
    if (llm && (llm.confidence ?? 0) >= 0.55) {
      // LLM 标成 L2 但结构已识别关联属性 → 抬升
      if (llm.tier === "L2" && structural && (structural.tier === "L3" || structural.tier === "L5")) {
        return { tier: structural.tier, source: "structural", reason: `${structural.reason}|override_llm_l2` };
      }
      return { tier: llm.tier, source: "llm", reason: llm.reason };
    }
  }
  if (structural && structural.confidence >= 0.68) {
    return { tier: structural.tier, source: "structural", reason: structural.reason };
  }
  if (structural) {
    return { tier: structural.tier, source: "structural", reason: structural.reason };
  }
  return { tier: "L3", source: "default", reason: "fallback" };
}

/** L2/L5+ 走 QueryIR 列链接 */
export function tierNeedsQueryIr(tier: QueryTier): boolean {
  return tier === "L2" || tier === "L5" || tier === "L6" || tier === "L7";
}

export function shouldUseQueryIrPath(
  tier: QueryTier,
  plan?: QueryPlan | null,
  executionShape?: string | null,
): boolean {
  if (executionShape === "scalar_lookup") return true;
  if (executionShape === "detail_rows") return false;
  if (tierNeedsQueryIr(tier)) return true;
  return planSuggestsMultiCondition(plan);
}
