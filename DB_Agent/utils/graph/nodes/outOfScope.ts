import type { GraphNode } from "@langchain/langgraph";
import { parseQueryPlan } from "../../nlu";
import { incrementLlmCallCount } from "../../llm_call_counter";
import { setRunMeta } from "../../query_metrics";
import { composeFriendlyAssistantReply } from "../../query_reflect";
import { sanitizeAssistantText } from "../../text";
import type { DbGraphState } from "../state";
import type { DbGraphDeps } from "../types";

export function createOutOfScopeNode(deps: DbGraphDeps): GraphNode<typeof DbGraphState> {
  const { largerModel, model, progress } = deps;
  return async (state) => {
    const q = String(state.standalone_question || state.question || "").trim();
    const plan = parseQueryPlan(state.query_plan_json);
    try {
      progress?.("正在组织回复…");
    } catch {}
    incrementLlmCallCount(1);
    const answer = await composeFriendlyAssistantReply(largerModel ?? model, {
      kind: "out_of_scope",
      question: q,
      data_domain: plan.data_domain,
    });
    setRunMeta({ path: "other", intent: "out_of_scope", data_domain: plan.data_domain });
    return { answer: sanitizeAssistantText(answer) };
  };
}
