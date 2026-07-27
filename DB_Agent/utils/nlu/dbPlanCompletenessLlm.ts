/**
 * Plan 完备门（启发模型）：是否可跳过 Stage-2、是否需 schema refine、可否走 person 快路径。
 * 语义决策只走 LLM；低置信时保守 structural fallback（宁多重抽，不答假数）。
 * 不对用户原话做业务关键词/正则路由。
 */
import { z } from "zod";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { QueryPlan } from "./query_plan";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";
import { clipText } from "./text";
import { incrementLlmCallCount } from "../llm_call_counter";
import { queryPlanReadyToSkipSlotLlm } from "./assemble_plan_slots";

const CompletenessSchema = z.object({
  ready_to_skip_slot_llm: z.boolean(),
  needs_schema_refine: z.boolean(),
  missing_slots: z.array(z.string()).max(8).optional(),
  implied_filters: z
    .array(
      z.object({
        field_hint: z.string(),
        value: z.string(),
        sql_match_value: z.string().optional(),
      }),
    )
    .max(8)
    .optional(),
  allow_person_fast_path: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});

export type PlanCompletenessResult = {
  ready_to_skip_slot_llm: boolean;
  needs_schema_refine: boolean;
  missing_slots: string[];
  implied_filters: Array<{ field_hint: string; value: string; sql_match_value: string }>;
  allow_person_fast_path: boolean;
  confidence: number;
  reason: string;
  source: "llm" | "structural";
};

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

export function isDbPlanCompletenessLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("plan_completeness");
}

/** 结构上是否已具备人员主表确定性统计（地区/年龄槽齐全），不读用户原话 */
export function structuralPersonFastPathReady(plan?: QueryPlan | null): boolean {
  if (!plan || !queryPlanReadyToSkipSlotLlm(plan)) return false;
  const slots = plan.filters?.slots ?? [];
  const hasRegion =
    (plan.entities?.locations?.length ?? 0) > 0 ||
    slots.some((s) => {
      const h = String(s.field_hint ?? "").toLowerCase();
      const v = String(s.sql_match_value || s.value || "").trim();
      return Boolean(v && (h.includes("region") || h.includes("location") || h.includes("地区")));
    });
  const hasAge = slots.some((s) => {
    const h = String(s.field_hint ?? "").toLowerCase();
    const v = String(s.sql_match_value || s.value || "").trim();
    return Boolean(v && h.includes("age"));
  });
  return hasRegion || hasAge;
}

/** 低置信 / LLM 关闭时的保守兜底：不跳过 Slot、要 refine；槽已齐时可开 person 快路径 */
export function conservativePlanCompletenessFallback(plan?: QueryPlan | null): PlanCompletenessResult {
  const structuralReady = queryPlanReadyToSkipSlotLlm(plan);
  const allowFast = structuralPersonFastPathReady(plan);
  return {
    ready_to_skip_slot_llm: false,
    needs_schema_refine: true,
    missing_slots: structuralReady ? [] : ["filters_or_slots"],
    implied_filters: [],
    allow_person_fast_path: allowFast,
    confidence: 0.4,
    reason: allowFast ? "conservative_structural_fallback|filters_ready" : "conservative_structural_fallback",
    source: "structural",
  };
}

function summarizePlan(plan?: QueryPlan | null): string {
  if (!plan) return "(无 plan)";
  const slots = (plan.filters?.slots ?? [])
    .map((s) => `${s.field_hint}=${s.sql_match_value || s.value}`)
    .join("; ");
  return [
    `intent=${plan.intent}`,
    `subject=${plan.subject}`,
    `data_domain=${plan.data_domain}`,
    `confidence=${plan.confidence}`,
    plan.metrics?.length ? `metrics=${plan.metrics.join("、")}` : "",
    plan.dimensions?.length ? `dimensions=${plan.dimensions.join("、")}` : "",
    plan.entities?.names?.length ? `names=${plan.entities.names.join("、")}` : "",
    plan.entities?.locations?.length ? `locations=${plan.entities.locations.join("、")}` : "",
    plan.filters?.where?.length ? `where=${plan.filters.where.join("；")}` : "",
    slots ? `slots=${slots}` : "slots=(空)",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeImplied(
  raw: PlanCompletenessResult["implied_filters"] | z.infer<typeof CompletenessSchema>["implied_filters"],
): PlanCompletenessResult["implied_filters"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => ({
      field_hint: String(s?.field_hint ?? "").trim(),
      value: String(s?.value ?? "").trim(),
      sql_match_value: String(s?.sql_match_value ?? s?.value ?? "").trim(),
    }))
    .filter((s) => s.field_hint && (s.value || s.sql_match_value))
    .slice(0, 8);
}

/** 将完备门 implied_filters 合并进 QueryPlan（再交 assemble 做格式展开） */
export function mergeImpliedFiltersIntoPlan(
  plan: QueryPlan,
  implied: PlanCompletenessResult["implied_filters"],
): QueryPlan {
  if (!implied.length) return plan;
  const slots = [...(plan.filters?.slots ?? [])];
  for (const s of implied) {
    const hint = s.field_hint.toLowerCase();
    const exists = slots.some((x) => {
      const h = String(x.field_hint ?? "").toLowerCase();
      const v = String(x.sql_match_value || x.value || "").trim();
      return h === hint && v === s.sql_match_value;
    });
    if (exists) continue;
    slots.push({
      field_hint: s.field_hint,
      value: s.value,
      sql_match_value: s.sql_match_value || s.value,
    });
  }
  return {
    ...plan,
    filters: {
      ...plan.filters,
      slots,
      where: [...(plan.filters?.where ?? [])],
      time_range: { ...(plan.filters?.time_range ?? { start: "", end: "", relative: "" }) },
    },
  };
}

async function inferCompletenessByLlm(
  model: BaseLanguageModel,
  question: string,
  plan?: QueryPlan | null,
  schemaSummary?: string,
): Promise<PlanCompletenessResult | null> {
  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是 NL2SQL Plan 完备检查器（对标 DIN-SQL/MAC-SQL decomposer completeness）。",
          "只输出 JSON，勿解释。按语义理解问题与当前 QueryPlan，勿用关键词表或正则硬匹配。",
          "字段：",
          "- ready_to_skip_slot_llm：槽位是否已足以跳过 Stage-2 抽槽（过滤/维度/指标齐全）",
          "- needs_schema_refine：是否还需对照表结构/列注释精炼 slots；若 Schema 摘要含 JSON 数组关联列（如 arr_*_id）或 metrics/filter 角色可能混淆（筛字段进了 metrics），应倾向 true",
          "- missing_slots：仍缺的槽名（如 region、age_gte、dimension、metric、entity_name）",
          "- implied_filters：问题隐含但 plan 未结构化的过滤（如群体年龄口径→age_gte；区划→region）。从语义与 schema 注释推断取值，勿写死业务常量",
          "- allow_person_fast_path：是否允许走人员主表确定性快路径（须结构化 region/age 等已齐且意图匹配）",
          "- confidence：0-1",
          'schema: {"ready_to_skip_slot_llm":bool,"needs_schema_refine":bool,"missing_slots":[],"implied_filters":[{"field_hint":"","value":"","sql_match_value":""}],"allow_person_fast_path":bool,"confidence":0-1,"reason":""}',
        ].join("\n"),
      ],
      [
        "human",
        clipText(
          [
            `问题：${question}`,
            "当前 QueryPlan：",
            summarizePlan(plan),
            schemaSummary ? `Schema 摘要：\n${clipText(schemaSummary, 1200)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          3500,
        ),
      ],
    ]);
    const text =
      typeof (res as { content?: string })?.content === "string"
        ? String((res as { content?: string }).content ?? "")
        : JSON.stringify((res as { content?: unknown })?.content ?? "");
    const parsed = CompletenessSchema.safeParse(safeJsonParse(text));
    if (!parsed.success) return null;
    const d = parsed.data;
    const confidence = Number.isFinite(d.confidence) ? Number(d.confidence) : 0.5;
    return {
      ready_to_skip_slot_llm: Boolean(d.ready_to_skip_slot_llm),
      needs_schema_refine: Boolean(d.needs_schema_refine),
      missing_slots: Array.isArray(d.missing_slots)
        ? d.missing_slots.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
        : [],
      implied_filters: normalizeImplied(d.implied_filters),
      allow_person_fast_path: Boolean(d.allow_person_fast_path),
      confidence,
      reason: String(d.reason ?? "llm").trim() || "llm",
      source: "llm",
    };
  } catch {
    return null;
  }
}

/**
 * 解析 Plan 完备结论：LLM 优先；confidence&lt;0.55 或关闭时 → 保守 fallback。
 */
export async function resolvePlanCompleteness(
  model: BaseLanguageModel | null,
  question: string,
  plan?: QueryPlan | null,
  opts?: { schemaSummary?: string },
): Promise<PlanCompletenessResult> {
  const fallback = conservativePlanCompletenessFallback(plan);
  if (!isDbPlanCompletenessLlmEnabled() || !model) return fallback;
  const q = String(question ?? "").trim();
  if (!q) return fallback;
  const llm = await inferCompletenessByLlm(model, q, plan, opts?.schemaSummary);
  if (!llm || llm.confidence < 0.55) return fallback;
  let out: PlanCompletenessResult = llm;
  // 结构门槛仍未满足时，不可因模型误判而跳过 Stage-2
  if (llm.ready_to_skip_slot_llm && !queryPlanReadyToSkipSlotLlm(plan)) {
    out = {
      ...llm,
      ready_to_skip_slot_llm: false,
      needs_schema_refine: true,
      reason: `${llm.reason}|structural_not_ready`,
    };
  }
  // 槽已结构齐全时，禁止 LLM 误关人员快路径（避免落 sql_agent 空答/明细包装）
  if (!out.allow_person_fast_path && structuralPersonFastPathReady(plan)) {
    out = {
      ...out,
      allow_person_fast_path: true,
      reason: `${out.reason}|structural_person_fast_path`,
    };
  }
  return out;
}

export function parsePlanCompletenessJson(raw: string | null | undefined): PlanCompletenessResult | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as PlanCompletenessResult;
    if (typeof j?.ready_to_skip_slot_llm !== "boolean") return null;
    return {
      ready_to_skip_slot_llm: Boolean(j.ready_to_skip_slot_llm),
      needs_schema_refine: Boolean(j.needs_schema_refine),
      missing_slots: Array.isArray(j.missing_slots) ? j.missing_slots.map(String) : [],
      implied_filters: normalizeImplied(j.implied_filters),
      allow_person_fast_path: Boolean(j.allow_person_fast_path),
      confidence: Number(j.confidence) || 0,
      reason: String(j.reason ?? ""),
      source: j.source === "llm" ? "llm" : "structural",
    };
  } catch {
    return null;
  }
}
