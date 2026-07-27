import type { GraphNode } from "@langchain/langgraph";
import { getDbAgentBlueprintEnv } from "../../db_agent_env";
import { parseQueryPlan } from "../../nlu";
import { assemblePlanSlotsOrNull } from "../../nlu/assemble_plan_slots";
import { refineQueryPlanWithSchemaGround } from "../../nlu/dbQuerySlotSchemaRefine";
import { resolveDbModelForStage, shouldRunSchemaSlotRefine } from "../../nlu/dbModelRouter";
import {
  mergeImpliedFiltersIntoPlan,
  parsePlanCompletenessJson,
  resolvePlanCompleteness,
} from "../../nlu/dbPlanCompletenessLlm";
import { parseManagerDbTaskFromJson } from "../../manager_task_context";
import { isAuthoritativeLlmTableJudge, runSchemaGround, type SchemaGroundResult } from "../../schema_ground";
import type { DbGraphState } from "../state";
import type { DbGraphDeps } from "../types";

export function createSchemaGroundNode(deps: DbGraphDeps): GraphNode<typeof DbGraphState> {
  const { config, ds, largerModel, model, progress, nluModel } = deps;
  return async (state) => {
    if (state.answer) return {};
    const blueprintEnv = getDbAgentBlueprintEnv();
    if (!blueprintEnv.enableSchemaGround) return { schema_ground_json: "" };
    const sq = String(state.standalone_question || state.question || "").trim();
    if (!sq) return { schema_ground_json: "" };
    const mgr = parseManagerDbTaskFromJson(String(state.manager_task_json || ""));
    let plan = parseQueryPlan(state.query_plan_json);
    const completenessModel = (nluModel ?? largerModel ?? model) as import("@langchain/openai").ChatOpenAI;

    const applySchemaSlotRefine = async (
      ground: SchemaGroundResult,
    ): Promise<{
      schema_ground_json: string;
      query_plan_json?: string;
      plan_completeness_json?: string;
    }> => {
      // 先用当前 plan 裁决是否 refine；merge/refine 后必须按最终 plan 重算完备门，
      // 避免 stale allow_person_fast_path=false 把已齐槽的人员快路径掐死。
      let completeness = await resolvePlanCompleteness(completenessModel, sq, plan, {
        schemaSummary: ground.schema_summary,
      });
      if (completeness.implied_filters.length) {
        plan = assemblePlanSlotsOrNull(mergeImpliedFiltersIntoPlan(plan, completeness.implied_filters)) ?? plan;
      }
      if (shouldRunSchemaSlotRefine(plan, completeness)) {
        const refineModel = resolveDbModelForStage(config, "schema_refine", { plan });
        const refined = await refineQueryPlanWithSchemaGround(refineModel, ds, {
          question: sq,
          queryPlan: plan,
          schemaGround: ground,
        });
        if (refined) {
          plan = assemblePlanSlotsOrNull(refined) ?? refined;
        }
      }
      completeness = await resolvePlanCompleteness(completenessModel, sq, plan, {
        schemaSummary: ground.schema_summary,
      });
      return {
        schema_ground_json: JSON.stringify(ground),
        query_plan_json: JSON.stringify(plan),
        plan_completeness_json: JSON.stringify(completeness),
      };
    };

    const prefetched = String(mgr?.prefetch_schema_ground_json ?? "").trim();
    if (prefetched) {
      try {
        const ground = JSON.parse(prefetched) as SchemaGroundResult;
        if (Array.isArray(ground.candidate_tables) && ground.candidate_tables.length) {
          if (mgr?.prefetch_reuse === true && isAuthoritativeLlmTableJudge(ground.table_judge)) {
            progress?.(`Schema 接地：复用总管预取选表（${ground.candidate_tables.length} 张表）`);
            return await applySchemaSlotRefine(ground);
          }
          progress?.("Schema 接地：预取候选已锁定，补充模型选表…");
        }
      } catch {
        /* fall through */
      }
    }
    try {
      progress?.("Schema 接地：正在检索相关表与字段…");
      const mgrForGround = (() => {
        if (!prefetched) return mgr;
        try {
          const g = JSON.parse(prefetched) as SchemaGroundResult;
          const tables = (g.candidate_tables ?? []).filter(Boolean);
          if (!tables.length) return mgr;
          return {
            ...(mgr ?? { source: "manager" as const }),
            hint_tables: Array.from(new Set([...tables, ...(mgr?.hint_tables ?? [])])).slice(0, 6),
            prefetch_reuse: false,
            prefetch_schema_ground_json: undefined,
          };
        } catch {
          return mgr;
        }
      })();
      const ground = await runSchemaGround(ds, {
        question: sq,
        queryPlan: plan,
        managerTask: mgrForGround,
        maxTables: blueprintEnv.schemaSummaryMaxTables + 1,
        charsPerTable: blueprintEnv.schemaSummaryCharsPerTable,
        judgeModel: blueprintEnv.enableSchemaTableJudge ? largerModel ?? model : null,
      });
      if (ground.candidate_tables.length) {
        progress?.(`Schema 接地：已锁定 ${ground.candidate_tables.length} 张候选表`);
      }
      progress?.("Schema 接地：精炼查询条件槽位…");
      return await applySchemaSlotRefine(ground);
    } catch {
      const prior = parsePlanCompletenessJson(String(state.plan_completeness_json || ""));
      return {
        schema_ground_json: "",
        plan_completeness_json: prior ? JSON.stringify(prior) : "",
      };
    }
  };
}
