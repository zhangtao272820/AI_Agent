/**
 * 分阶段模型路由：简单查询用 flash 省 token；复杂查询用更强模型保正确率。
 * 复杂与否仅看 QueryPlan 结构 + 可选 tier；schema refine 由 Plan 完备门驱动。
 */
import type { ChatOpenAI } from "@langchain/openai";
import { getChatModel, getNluChatModel, getOrchestrationChatModel, getSqlCoderChatModel } from "../agent";
import type { QueryPlan } from "./query_plan";
import type { QueryTier } from "./dbComplexityLlm";
import { queryPlanLooksComplex } from "./dbAnswerFormat";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";
import type { PlanCompletenessResult } from "./dbPlanCompletenessLlm";

export type DbModelStage =
  | "condense"
  | "intent_slot"
  | "schema_refine"
  | "schema_link"
  | "filter_map"
  | "sql_codegen"
  | "sql_repair"
  | "result_column";

type RouterConfig = {
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  openaiOrchestrationModel?: string;
  openaiNluModel?: string;
  openaiAgentModel?: string;
  openaiComplexModel?: string;
};

function tierIsComplex(tier?: QueryTier | null): boolean {
  if (!tier) return false;
  return tier === "L4" || tier === "L5" || tier === "L6" || tier === "L7" || tier === "L8" || tier === "L9";
}

export function isComplexDbQuery(plan?: QueryPlan | null, tier?: QueryTier | null): boolean {
  return tierIsComplex(tier) || queryPlanLooksComplex(plan);
}

export function getComplexChatModel(config: RouterConfig): ChatOpenAI {
  const complex = String(config.openaiComplexModel ?? process.env.OPENAI_COMPLEX_MODEL ?? "").trim();
  if (complex) {
    return getChatModel({
      openaiApiKey: config.openaiApiKey,
      openaiBaseUrl: config.openaiBaseUrl,
      openaiModel: complex,
    });
  }
  return getSqlCoderChatModel(config);
}

/** 按阶段选模型：复杂查询的 schema/SQL 阶段用 COMPLEX 或 Coder，其余用 flash NLU/Orchestration */
export function resolveDbModelForStage(
  config: RouterConfig,
  stage: DbModelStage,
  opts?: { plan?: QueryPlan | null; tier?: QueryTier | null },
): ChatOpenAI {
  const complex = isComplexDbQuery(opts?.plan, opts?.tier);

  switch (stage) {
    case "condense":
    case "intent_slot":
    case "result_column":
      return getNluChatModel(config);
    case "schema_refine":
    case "schema_link":
    case "filter_map":
      return complex ? getComplexChatModel(config) : getOrchestrationChatModel(config);
    case "sql_codegen":
    case "sql_repair":
      return complex ? getComplexChatModel(config) : getSqlCoderChatModel(config);
    default:
      return getOrchestrationChatModel(config);
  }
}

/**
 * 是否跑 schema slot refine。
 * 优先读完备门 needs_schema_refine；否则仅结构复杂 → refine；禁人员域关键词表。
 */
export function shouldRunSchemaSlotRefine(
  plan?: QueryPlan | null,
  completeness?: PlanCompletenessResult | null,
): boolean {
  if (!isDbNluFeatureEnabled("slot_schema_refine")) return false;
  const mode = String(process.env.DB_QUERY_SLOT_SCHEMA_REFINE ?? "auto").trim();
  if (mode === "0") return false;
  if (mode === "auto") {
    if (completeness) return Boolean(completeness.needs_schema_refine);
    return queryPlanLooksComplex(plan);
  }
  return true;
}

export function shouldRunResultColumnLlm(plan?: QueryPlan | null, columnCount?: number): boolean {
  if (!isDbNluFeatureEnabled("result_column")) return false;
  if (columnCount != null && columnCount <= 2 && !queryPlanLooksComplex(plan)) return false;
  return true;
}
