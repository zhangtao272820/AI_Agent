import type { GraphNode } from "@langchain/langgraph";
import { DB_AGENT_DEFAULTS } from "../../db_agent_env";
import { inferIntentFromPlan, inferIntentHeuristic, parseQueryPlan } from "../../nlu";
import { resolveQueryTier } from "../../nlu/dbComplexityLlm";
import { incrementLlmCallCount } from "../../llm_call_counter";
import { stashQueryTier } from "../../query_metrics";
import {
  buildRouteDecision,
  formatRouteProgressLabel,
  type RouteDecision,
} from "../../route";
import type { SchemaGroundResult } from "../../schema_ground";
import type { DbGraphState } from "../state";
import type { DbGraphDeps } from "../types";

export function createRouteNode(deps: DbGraphDeps): GraphNode<typeof DbGraphState> {
  const { domainEnabled, largerModel, model, progress, routingChain, skills } = deps;
  return async (state) => {
    if (state.answer) return {};
    const sq = String(state.standalone_question || state.question || "").trim();
    let planned = parseQueryPlan(state.query_plan_json);
    let schemaGround: SchemaGroundResult | null = null;
    try {
      const raw = String(state.schema_ground_json || "").trim();
      if (raw) schemaGround = JSON.parse(raw) as SchemaGroundResult;
    } catch {
      schemaGround = null;
    }

    if (DB_AGENT_DEFAULTS.enableRoutePolicy) {
      const tierResolved = await resolveQueryTier(
        (largerModel ?? model) as import("@langchain/openai").ChatOpenAI,
        sq,
        planned,
      );
      if (tierResolved?.tier) stashQueryTier(tierResolved.tier, `${tierResolved.source}:${tierResolved.reason}`);
      const decision = buildRouteDecision({
        question: sq,
        plan: planned,
        schemaGround,
        queryTier: tierResolved.tier,
      });
      if (decision.intent === "person_info" && skills.person_info.enabled === false) {
        decision.intent = "sql_agent";
        decision.executionPath = "sql_preflight";
        decision.skipSqlDirect = false;
        decision.reasons.push("person_info 未启用→改走 SQL 路径");
      }
      planned = decision.refinedPlan;
      try {
        progress?.(`路径策略：${formatRouteProgressLabel(decision)}`);
      } catch {}
      return {
        intent: decision.intent,
        query_plan_json: JSON.stringify(planned),
        route_policy_json: JSON.stringify({
          hintBlock: decision.hintBlock,
          reasons: decision.reasons,
          executionPath: decision.executionPath,
          contextKey: decision.contextKey,
          skipSqlDirect: decision.skipSqlDirect,
          alignment: decision.alignment,
        } satisfies Partial<RouteDecision> & { skipSqlDirect: boolean }),
        route_skip_sql_direct: decision.skipSqlDirect,
      };
    }

    if (planned.intent !== "unknown") {
      const fromPlan = inferIntentFromPlan(planned);
      if (fromPlan) return { intent: fromPlan };
    }
    const local = inferIntentHeuristic(sq, domainEnabled);
    if (local) return { intent: local };
    const intent = await routingChain.invoke({ standalone_question: sq });
    incrementLlmCallCount(1);
    return { intent: String(intent ?? "sql_agent") };
  };
}
