import type { GraphNode } from "@langchain/langgraph";
import { parseQueryPlan } from "../../nlu";
import { buildClarificationSuggestions } from "../../clarification_hints";
import { setRunMeta } from "../../query_metrics";
import type { DbGraphState } from "../state";
import type { DbGraphEarlyDeps } from "../types";

export function createClarifyNode(deps: Pick<DbGraphEarlyDeps, "progress">): GraphNode<typeof DbGraphState> {
  const { progress } = deps;
  return async (state) => {
    const q = String(state.clarification_question || "").trim();
    if (!q) return {};
    const plan = parseQueryPlan(state.query_plan_json);
    const suggestions = buildClarificationSuggestions({
      clarificationQuestion: q,
      missingSlots: plan.missing_slots,
      lastUserQuestion: String(state.standalone_question || state.question || ""),
    });
    setRunMeta({
      path: "clarify",
      needs_clarification: true,
      clarification_question: q,
      missing_slots: plan.missing_slots,
      clarification_suggestions: suggestions,
      data_domain: plan.data_domain,
      intent: plan.intent,
    });
    try {
      progress?.("需要补充信息后再查询…");
    } catch {}
    return { answer: q };
  };
}
