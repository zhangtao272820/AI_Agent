/**
 * 两阶段问句拆解编排：Intent（Stage-1）→ Slot（Stage-2）→ QueryPlan。
 * 是否跳过 Stage-2 由 Plan 完备启发模型裁决（禁语义关键词正则）。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { QueryPlan } from "./query_plan";
import { parseQueryPlan } from "./query_plan";
import { resolveQueryIntent, type DbQueryIntent } from "./dbQueryIntentLlm";
import { resolveQueryPlanViaDecomposition } from "./dbQuerySlotLlm";
import { assemblePlanSlotsOrNull, queryPlanReadyToSkipSlotLlm } from "./assemble_plan_slots";
import { recallDbIntentPlaybook, mergeDbIntentRecall } from "./dbIntentRag";
import {
  mergeImpliedFiltersIntoPlan,
  resolvePlanCompleteness,
  type PlanCompletenessResult,
} from "./dbPlanCompletenessLlm";

import { isDbNluFeatureEnabled } from "../db_nlu_mode";

export function isDbQueryDecomposeEnabled(): boolean {
  return isDbNluFeatureEnabled("decompose");
}

export type DecomposeResult = {
  plan: QueryPlan;
  dbIntent: DbQueryIntent;
  intentSource: "llm" | "structural" | "default" | "playbook_rag" | "experience_rag" | "manager";
  slotSource: "llm" | "fallback" | "manager";
  completeness?: PlanCompletenessResult;
};

export async function buildQueryPlanViaDecomposition(
  model: BaseLanguageModel | null,
  question: string,
  monolithicPlan?: QueryPlan | null,
): Promise<DecomposeResult | null> {
  if (!isDbQueryDecomposeEnabled()) return null;

  const assembledMono = monolithicPlan ? assemblePlanSlotsOrNull(monolithicPlan) : null;
  if (assembledMono && queryPlanReadyToSkipSlotLlm(assembledMono)) {
    const completeness = await resolvePlanCompleteness(model, question, assembledMono);
    const withImplied = assemblePlanSlotsOrNull(
      mergeImpliedFiltersIntoPlan(assembledMono, completeness.implied_filters),
    );
    const planForSkip = withImplied ?? assembledMono;
    if (
      completeness.confidence >= 0.55 &&
      completeness.ready_to_skip_slot_llm &&
      queryPlanReadyToSkipSlotLlm(planForSkip)
    ) {
      const intentRes = mergeDbIntentRecall(
        await resolveQueryIntent(model, question, planForSkip),
        recallDbIntentPlaybook(question),
      );
      return {
        plan: planForSkip,
        dbIntent: intentRes.intent,
        intentSource: "manager",
        slotSource: "manager",
        completeness,
      };
    }
  }

  const intentRes = mergeDbIntentRecall(
    await resolveQueryIntent(model, question, monolithicPlan),
    recallDbIntentPlaybook(question),
  );

  let dbIntent = intentRes.intent;
  let slotPlan = await resolveQueryPlanViaDecomposition(model, question, dbIntent);

  // 仅当 Stage-1 已是 distribution，或完备门明确指向分布（缺维度）时，才用 distribution 重抽。
  // attribute_lookup / detail_list 缺口不得改成 distribution，否则会污染 metrics/dim 并拖垮 JSON 关联。
  if (
    (!slotPlan || !queryPlanReadyToSkipSlotLlm(slotPlan)) &&
    dbIntent !== "attribute_lookup" &&
    dbIntent !== "detail_list" &&
    dbIntent !== "schema_help" &&
    dbIntent !== "out_of_scope"
  ) {
    const probePlan = slotPlan ?? assembledMono ?? monolithicPlan ?? null;
    const completenessProbe = await resolvePlanCompleteness(model, question, probePlan);
    const pointsAtDistribution =
      dbIntent === "distribution" ||
      completenessProbe.missing_slots.some((s) => /dimension|dim|分组/i.test(s)) ||
      (completenessProbe.reason || "").toLowerCase().includes("distribution");
    if (
      pointsAtDistribution &&
      (completenessProbe.needs_schema_refine ||
        completenessProbe.missing_slots.length > 0 ||
        !completenessProbe.ready_to_skip_slot_llm)
    ) {
      const retry = await resolveQueryPlanViaDecomposition(model, question, "distribution");
      if (retry) {
        const mergedRetry = assemblePlanSlotsOrNull(
          mergeImpliedFiltersIntoPlan(retry, completenessProbe.implied_filters),
        );
        if (
          mergedRetry &&
          (!slotPlan ||
            queryPlanReadyToSkipSlotLlm(mergedRetry) ||
            !queryPlanReadyToSkipSlotLlm(slotPlan))
        ) {
          slotPlan = mergedRetry;
          dbIntent = "distribution";
        }
      }
    }
  }

  if (slotPlan) {
    const completeness = await resolvePlanCompleteness(model, question, slotPlan);
    const merged = assemblePlanSlotsOrNull(
      mergeImpliedFiltersIntoPlan(slotPlan, completeness.implied_filters),
    );
    if (!merged) return null;
    return {
      plan: merged,
      dbIntent,
      intentSource: intentRes.source as DecomposeResult["intentSource"],
      slotSource: "llm",
      completeness,
    };
  }

  if (monolithicPlan && monolithicPlan.confidence >= 0.35 && monolithicPlan.intent !== "unknown") {
    const completeness = await resolvePlanCompleteness(model, question, monolithicPlan);
    const assembledFallback = assemblePlanSlotsOrNull(
      mergeImpliedFiltersIntoPlan(monolithicPlan, completeness.implied_filters),
    );
    if (!assembledFallback) return null;
    return {
      plan: assembledFallback,
      dbIntent,
      intentSource: intentRes.source as DecomposeResult["intentSource"],
      slotSource: "fallback",
      completeness,
    };
  }

  return null;
}

/** 供测试/调试：从 monolithic raw JSON 走完整拆解 */
export async function decomposeQuestionToPlan(
  model: BaseLanguageModel | null,
  question: string,
  monolithicRaw?: string,
): Promise<DecomposeResult | null> {
  const mono = monolithicRaw ? parseQueryPlan(monolithicRaw) : null;
  return buildQueryPlanViaDecomposition(model, question, mono);
}
