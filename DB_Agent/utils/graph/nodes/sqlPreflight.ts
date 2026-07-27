import type { BaseMessage } from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";
import { getDbAgentBlueprintEnv } from "../../db_agent_env";
import { getMessageRole, mergeFollowupQuestionWithHistory } from "../../nlu";
import { parseManagerDbTaskFromJson, mergeManagerIntoPreflight } from "../../manager_task_context";
import { fallbackPreflight, runSqlPreflight } from "../../sql_preflight";
import type { DbGraphState } from "../state";
import type { DbGraphDeps } from "../types";

export function createSqlPreflightNode(deps: DbGraphDeps): GraphNode<typeof DbGraphState> {
  const { largerModel, model, progress } = deps;
  return async (state) => {
    if (state.answer) return {};
    const env = getDbAgentBlueprintEnv();
    if (!env.enableSqlPreflight || env.enableSqlPlanDirect) return { sql_preflight_json: "" };
    const sq = String(state.standalone_question || state.question || "").trim();
    const mgr = parseManagerDbTaskFromJson(String(state.manager_task_json || ""));
    if (!sq || sq.length < env.sqlPreflightMinQuestionChars) {
      const fb = fallbackPreflight(sq);
      return { sql_preflight_json: JSON.stringify(mgr ? mergeManagerIntoPreflight(mgr, fb, sq) : fb) };
    }
    try {
      const planQuestion = mergeFollowupQuestionWithHistory(
        sq,
        (state.chat_history as BaseMessage[]) ?? [],
        getMessageRole,
      );
      const planJson = String(state.query_plan_json || "").trim();
      progress?.("多节点编排：自然语言 → 查询要点…");
      const pre = await runSqlPreflight(largerModel ?? model, {
        question: planQuestion,
        query_plan_json: planJson || "{}",
      });
      const merged = mgr ? mergeManagerIntoPreflight(mgr, pre, sq) : pre;
      return { sql_preflight_json: JSON.stringify(merged) };
    } catch {
      const fb = fallbackPreflight(sq);
      return { sql_preflight_json: JSON.stringify(mgr ? mergeManagerIntoPreflight(mgr, fb, sq) : fb) };
    }
  };
}
