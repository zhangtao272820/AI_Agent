/**
 * Plan 后澄清门控：由启发模型判断问句是否已足够具体，替代问句 regex / 词表。
 */
import { z } from "zod";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { QueryPlan } from "./query_plan";
import { shouldClarifyBeforeExecution } from "./signals";
import { resolveQueryPlanViaDecomposition } from "./dbQuerySlotLlm";
import type { DbQueryIntent } from "./dbQueryIntentLlm";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";
import { clipText } from "./text";

const GateSchema = z.object({
  should_clarify: z.boolean(),
  clarification_question: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional(),
});

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

export function isDbClarifyGateLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("clarify_gate");
}

function planIntentToDbIntent(plan: QueryPlan): DbQueryIntent {
  switch (plan.intent) {
    case "detail":
      return "detail_list";
    case "trend":
      return "trend";
    case "comparison":
      return "comparison";
    case "schema_help":
      return "schema_help";
    case "out_of_scope":
      return "out_of_scope";
    case "aggregation":
      return "distribution";
    default:
      return "unknown";
  }
}

function mergeUniqueStrings(base: string[], extra: string[]): string[] {
  const out = [...base];
  const seen = new Set(base.map((x) => x.trim()).filter(Boolean));
  for (const raw of extra) {
    const v = String(raw ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** 将 Stage-2 槽位 LLM 产出合并进已有 Plan（仅补空槽，不覆盖已有槽） */
export function mergeSlotRefillIntoPlan(base: QueryPlan, refill: QueryPlan): QueryPlan {
  return {
    ...base,
    subject: base.subject !== "unknown" ? base.subject : refill.subject,
    data_domain: base.data_domain !== "general" ? base.data_domain : refill.data_domain,
    entities: {
      names: mergeUniqueStrings(base.entities.names, refill.entities.names),
      locations: mergeUniqueStrings(base.entities.locations ?? [], refill.entities.locations ?? []),
      orgs: mergeUniqueStrings(base.entities.orgs ?? [], refill.entities.orgs ?? []),
      ids: mergeUniqueStrings(base.entities.ids ?? [], refill.entities.ids ?? []),
    },
    metrics: mergeUniqueStrings(base.metrics, refill.metrics),
    dimensions: mergeUniqueStrings(base.dimensions, refill.dimensions),
    filters: {
      time_range: {
        start: base.filters.time_range.start || refill.filters.time_range.start,
        end: base.filters.time_range.end || refill.filters.time_range.end,
        relative: base.filters.time_range.relative || refill.filters.time_range.relative,
      },
      where: mergeUniqueStrings(base.filters.where, refill.filters.where),
      slots: base.filters.slots?.length ? base.filters.slots : refill.filters.slots,
    },
    confidence: Math.max(base.confidence, refill.confidence),
    missing_slots: base.missing_slots.length ? base.missing_slots : refill.missing_slots,
    needs_clarification: base.needs_clarification || refill.needs_clarification,
    clarification_question: base.clarification_question || refill.clarification_question,
  };
}

function planSummary(plan: QueryPlan): string {
  return JSON.stringify(
    {
      intent: plan.intent,
      subject: plan.subject,
      data_domain: plan.data_domain,
      entities: plan.entities,
      metrics: plan.metrics,
      dimensions: plan.dimensions,
      filters: {
        where: plan.filters.where,
        time_range: plan.filters.time_range,
      },
      missing_slots: plan.missing_slots,
      needs_clarification: plan.needs_clarification,
      confidence: plan.confidence,
    },
    null,
    0,
  );
}

async function judgeClarifyByLlm(
  model: BaseLanguageModel,
  plan: QueryPlan,
  question: string,
  structuralReason?: string,
): Promise<{ needed: boolean; question: string; reason?: string } | null> {
  if (!isDbClarifyGateLlmEnabled()) return null;
  const q = String(question ?? "").trim();
  if (!q) return null;
  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是数据库查询澄清门控器。根据用户问句与 QueryPlan，判断是否需要向用户追问才能安全执行 SQL。",
          "只输出 JSON，禁止 markdown。",
          "规则：",
          "- 问句已明确统计对象、地区、指标、时间范围等关键条件 → should_clarify=false。",
          "- 仅当 Plan 槽位与问句均无法确定查什么、查谁、统计什么时 → should_clarify=true。",
          "- 短句但语义完整（如「[地区]+[指标对象]」）→ should_clarify=false。",
          "- 泛化角色句或占位句（如「从数据库查询结构化数据」）→ should_clarify=true 并给出 clarification_question。",
          "- 禁止用关键词表/正则；基于语义理解决策。",
          'schema: {"should_clarify":bool,"clarification_question":string,"confidence":0-1,"rationale":string}',
        ].join("\n"),
      ],
      [
        "human",
        clipText(
          `用户问句：${q}\nQueryPlan：${planSummary(plan)}\n结构性门控建议澄清：${structuralReason || "无"}`,
          1800,
        ),
      ],
    ]);
    const text =
      typeof (res as { content?: unknown })?.content === "string"
        ? (res as { content: string }).content
        : JSON.stringify((res as { content?: unknown })?.content);
    const parsed = GateSchema.safeParse(safeJsonParse(text));
    if (!parsed.success) return null;
    if (Number(parsed.data.confidence ?? 0) < 0.45) return null;
    if (!parsed.data.should_clarify) {
      return { needed: false, question: "", reason: parsed.data.rationale || "llm_clarify_gate" };
    }
    const cq = String(parsed.data.clarification_question || "").trim();
    return {
      needed: true,
      question: cq || "为保证查询准确，请补充一个关键条件（如时间范围、查询对象或统计口径）。",
      reason: parsed.data.rationale || "llm_clarify_gate",
    };
  } catch {
    return null;
  }
}

/**
 * Plan 节点澄清决策：先 Stage-2 槽位补全，再结构性门控，最后 LLM 门控。
 */
export async function resolveClarifyBeforeExecution(
  model: BaseLanguageModel | null,
  plan: QueryPlan,
  question: string,
): Promise<{ needed: boolean; question: string; reason?: string; plan: QueryPlan }> {
  let working = plan;
  const underSpecified =
    (working.intent === "aggregation" ||
      working.intent === "trend" ||
      working.intent === "comparison") &&
    !working.metrics.length &&
    !working.dimensions.length;

  if (underSpecified && model) {
    const refill = await resolveQueryPlanViaDecomposition(model, question, planIntentToDbIntent(working));
    if (refill) working = mergeSlotRefillIntoPlan(working, refill);
  }

  const structural = shouldClarifyBeforeExecution(working, question);
  if (!structural.needed) {
    return { ...structural, plan: working };
  }

  if (model) {
    const llm = await judgeClarifyByLlm(model, working, question, structural.reason || structural.question);
    if (llm) return { ...llm, plan: working };
  }

  return { ...structural, plan: working };
}
