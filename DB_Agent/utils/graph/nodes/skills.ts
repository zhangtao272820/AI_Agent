import type { GraphNode } from "@langchain/langgraph";
import { composeFriendlyAssistantReply } from "../../query_reflect";
import { setRunMeta } from "../../query_metrics";
import { incrementLlmCallCount } from "../../llm_call_counter";
import { sanitizeAssistantText } from "../../text";
import type { DbGraphState } from "../state";
import type { DbGraphDeps } from "../types";

export function createHelpNode(deps: DbGraphDeps): GraphNode<typeof DbGraphState> {
  const { largerModel, model, progress } = deps;
  return async (state) => {
    const q = String(state.standalone_question || state.question || "").trim();
    try {
      progress?.("正在组织回复…");
    } catch {}
    incrementLlmCallCount(1);
    const answer = await composeFriendlyAssistantReply(largerModel ?? model, {
      kind: "help",
      question: q || "你好",
    });
    setRunMeta({ path: "other", intent: "help" });
    return { answer: sanitizeAssistantText(answer) };
  };
}

export function createPersonInfoNode(deps: DbGraphDeps): GraphNode<typeof DbGraphState> {
  const { skillRunCtx, skills } = deps;
  return async (state) => {
    const q = String(state.standalone_question || state.question || "").trim();
    return { answer: await skills.person_info.run(q, skillRunCtx(state)) };
  };
}

export function createPersonHealthNode(deps: DbGraphDeps): GraphNode<typeof DbGraphState> {
  const { skillRunCtx, skills } = deps;
  return async (state) => {
    const q = String(state.standalone_question || state.question || "").trim();
    return { answer: await skills.person_health.run(q, skillRunCtx(state)) };
  };
}

export function createStatisticsNode(deps: DbGraphDeps): GraphNode<typeof DbGraphState> {
  const { skillRunCtx, skills } = deps;
  return async (state) => {
    const q = String(state.standalone_question || state.question || "").trim();
    return { answer: await skills.statistics.run(q, skillRunCtx(state)) };
  };
}
