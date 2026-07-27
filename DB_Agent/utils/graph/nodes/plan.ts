import type { BaseMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import type { GraphNode } from "@langchain/langgraph";
import { getDbAgentBlueprintEnv } from "../../db_agent_env";
import {
  createQueryPlanPrompt,
  extractNameCandidatesFromQuestion,
  getMessageRole,
  mergeFollowupQuestionWithHistory,
  parseQueryPlan,
  type QueryPlan,
} from "../../nlu";
import { assemblePlanSlotsOrNull, exportQueryPlanForState } from "../../nlu/assemble_plan_slots";
import { resolveClarifyBeforeExecution } from "../../nlu/dbClarifyGateLlm";
import { resolveDbEntity } from "../../nlu/dbEntityLlm";
import {
  applyExecutionShapeToPlan,
  inferExecutionShapeStructural,
  isFilteredPersonDistributionPlan,
  planMetricsLookLikeDetailEnumerate,
  resolveQueryExecutionShape,
} from "../../nlu/dbQueryExecutionShapeLlm";
import { buildQueryPlanViaDecomposition } from "../../nlu/dbQueryDecompose";
import { understandDbQueryMerged, isDbMergedUnderstandEnabled } from "../../nlu/dbMergedUnderstand";
import { enrichPlanWithPatchTimeDefaults } from "../../nlu/plan_time_defaults";
import { resolveStructuralOrNull } from "../../nlu/structural_query_plan";
import { resolveTaskStack } from "../../nlu/dbTaskStackLlm";
import { incrementLlmCallCount } from "../../llm_call_counter";
import {
  mergeManagerConstraintsIntoPlan,
  parseManagerDbTaskFromJson,
  resolveManagerAssembledQueryPlan,
  shouldPreferManagerQueryPlan,
  shouldSkipMonolithicPlanLlmForManager,
  shouldUseManagerAssembledQueryPlan,
  executionShapeFromManagerTask,
} from "../../manager_task_context";
import { getRunMeta, setRunMeta } from "../../query_metrics";
import { detectTaskStack } from "../../task_stack";
import { formatUserPreferencesBlock } from "../../user_preferences";
import type { DbGraphState } from "../state";
import type { DbGraphEarlyDeps } from "../types";

export function createPlanNode(deps: DbGraphEarlyDeps): GraphNode<typeof DbGraphState> {
  const { model, nluModel, largerModel, progress } = deps;
  const queryPlanPrompt = () => createQueryPlanPrompt();
  const planModel = (largerModel ?? model) as import("@langchain/openai").ChatOpenAI;

  return async (state) => {
    if (state.answer) return {};
    const sq = String(state.standalone_question || state.question || "").trim();
    if (!sq) return {};
    const mgr = parseManagerDbTaskFromJson(String(state.manager_task_json || ""));
    const planQuestion = mergeFollowupQuestionWithHistory(sq, (state.chat_history as BaseMessage[]) ?? [], getMessageRole);
    try {
      let plan: QueryPlan;
      let usedStructuralPlan = false;
      let usedManagerPlan = false;
      let usedDecomposedPlan = false;
      let decomposed: Awaited<ReturnType<typeof buildQueryPlanViaDecomposition>> = null;
      if (shouldUseManagerAssembledQueryPlan(mgr)) {
        plan = mergeManagerConstraintsIntoPlan(mgr, resolveManagerAssembledQueryPlan(mgr)!);
        usedManagerPlan = true;
      } else if (shouldPreferManagerQueryPlan(mgr)) {
        plan = parseQueryPlan(String(mgr!.query_plan_json));
        const assembled = assemblePlanSlotsOrNull(plan);
        plan = mergeManagerConstraintsIntoPlan(mgr, assembled ?? plan);
        usedManagerPlan = true;
      } else if (shouldSkipMonolithicPlanLlmForManager(mgr)) {
        const monoFromMgr = resolveManagerAssembledQueryPlan(mgr);
        decomposed = await buildQueryPlanViaDecomposition(planModel, planQuestion, monoFromMgr);
        if (decomposed) {
          plan = mergeManagerConstraintsIntoPlan(mgr, decomposed.plan);
          usedDecomposedPlan = decomposed.slotSource === "llm";
        } else {
          plan = mergeManagerConstraintsIntoPlan(mgr, parseQueryPlan("{}"));
        }
      } else {
        const prefBlock = getDbAgentBlueprintEnv().enableUserPreferences
          ? formatUserPreferencesBlock(String(state.session_id || ""))
          : "";
        const planInput = prefBlock ? `${prefBlock}\n\n${planQuestion}` : planQuestion;
        const raw = await RunnableSequence.from([
          queryPlanPrompt(),
          largerModel ?? model,
          new StringOutputParser(),
        ]).invoke({ question: planInput });
        incrementLlmCallCount(1);
        plan = parseQueryPlan(raw);
        plan = mergeManagerConstraintsIntoPlan(mgr, plan);
        if (isDbMergedUnderstandEnabled()) {
          const merged = await understandDbQueryMerged({
            question: sq,
            chatHistory: (state.chat_history as BaseMessage[]) ?? [],
            model: planModel,
            condenseModel: (nluModel ?? model) as import("@langchain/openai").ChatOpenAI,
            monolithicPlan: plan,
            skipCondense: Boolean(mgr?.source === "manager"),
          });
          decomposed = merged.decomposed;
        } else {
          decomposed = await buildQueryPlanViaDecomposition(planModel, planQuestion, plan);
        }
        if (decomposed) {
          plan = mergeManagerConstraintsIntoPlan(mgr, decomposed.plan);
          usedDecomposedPlan = decomposed.slotSource === "llm";
        }
        if (plan.intent === "unknown" || plan.confidence < 0.35) {
          const structural = resolveStructuralOrNull(planQuestion);
          if (structural) {
            plan = mergeManagerConstraintsIntoPlan(mgr, structural);
            usedStructuralPlan = true;
          }
        }
      }
      plan = enrichPlanWithPatchTimeDefaults(planQuestion, plan);
      if (plan.entities.names.length === 0) {
        const names = extractNameCandidatesFromQuestion(planQuestion);
        if (names.length) plan.entities.names = names.slice(0, 3);
        if (plan.entities.names.length === 0 && !usedStructuralPlan && !usedManagerPlan) {
          const entity = await resolveDbEntity(planModel, planQuestion, plan.entities.names);
          if (entity.names.length) {
            plan.entities.names = Array.from(new Set(entity.names)).slice(0, 3);
          }
        }
      }
      const shapeRes = await resolveQueryExecutionShape(
        planModel,
        planQuestion,
        plan,
        executionShapeFromManagerTask(mgr),
      );
      let finalShape = shapeRes.shape;
      // Plan metrics 指向明细枚举时，禁止 attribute→scalar 覆盖（否则课程明细掉进题库 JSON join）
      if (planMetricsLookLikeDetailEnumerate(plan)) {
        finalShape = "detail_rows";
      } else if (decomposed?.dbIntent === "attribute_lookup") {
        finalShape = "scalar_lookup";
      } else if (
        decomposed?.dbIntent === "detail_list" &&
        finalShape !== "distribution" &&
        !isFilteredPersonDistributionPlan(plan)
      ) {
        // 勿用 detail_list 覆盖已判定/可守卫的人口分布
        finalShape = "detail_rows";
      } else if (
        shapeRes.source === "llm" &&
        shapeRes.shape === "detail_rows" &&
        !isFilteredPersonDistributionPlan(plan)
      ) {
        finalShape = "detail_rows";
      } else if (finalShape !== "distribution" && finalShape !== "trend") {
        // 已 guard 为 distribution 时禁止 structural scalar_lookup 覆盖（否则性别分布掉进明细）
        const structuralShape = inferExecutionShapeStructural(plan);
        if (structuralShape?.shape === "scalar_lookup" && structuralShape.confidence >= 0.65) {
          finalShape = "scalar_lookup";
        }
      }
      // 带过滤的人口分布：无论上游 intent，执行形态强制 distribution
      if (isFilteredPersonDistributionPlan(plan)) {
        finalShape = "distribution";
      }
      plan = applyExecutionShapeToPlan(plan, finalShape);
      try {
        progress?.("已完成问题拆解，正在确认查询目标...");
      } catch {}
      const out: Record<string, unknown> = {
        execution_shape_json: JSON.stringify({
          shape: finalShape,
          source: decomposed?.dbIntent === "attribute_lookup" ? "intent_override" : shapeRes.source,
          db_intent: decomposed?.dbIntent,
          intent_source: decomposed?.intentSource,
        }),
      };
      if (usedStructuralPlan) out.structural_plan_used = true;
      if (usedDecomposedPlan) out.decompose_plan_used = true;
      if (usedManagerPlan) out.manager_plan_used = true;
      setRunMeta({
        ...(getRunMeta() ?? { path: "other" }),
        execution_shape: finalShape,
        execution_shape_source: decomposed?.dbIntent === "attribute_lookup" ? "intent_override" : shapeRes.source,
      });
      const clarifyRes = await resolveClarifyBeforeExecution(planModel, plan, planQuestion);
      plan = clarifyRes.plan;
      const exported = exportQueryPlanForState(plan);
      plan = exported.plan;
      if (exported.slotRejectReason && !clarifyRes.needed) {
        out.clarification_question =
          plan.clarification_question?.trim() ||
          "请补充更具体的地区、时间或筛选条件后再查询。";
        out.query_plan_json = JSON.stringify(plan);
        return out;
      }
      out.query_plan_json = JSON.stringify(plan);
      if (decomposed?.completeness) {
        out.plan_completeness_json = JSON.stringify(decomposed.completeness);
      }
      if (clarifyRes.needed) {
        out.clarification_question = clarifyRes.question;
      } else if (!state.bypass_task_stack) {
        const stack =
          (await resolveTaskStack(planModel, planQuestion, plan)) ?? detectTaskStack(planQuestion, plan);
        if (stack) out.task_stack_json = JSON.stringify(stack);
      }
      return out;
    } catch {
      return {};
    }
  };
}
