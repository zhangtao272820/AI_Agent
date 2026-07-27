import type { GraphNode } from "@langchain/langgraph";
import { findRepeatAnswer } from "../../nlu";
import { shouldBypassFastPathsForQuestion } from "../../query_learning";
import type { DbGraphState } from "../state";

export function createRepeatNode(): GraphNode<typeof DbGraphState> {
  return async (state) => {
    const q = String(state.question ?? "").trim();
    if (shouldBypassFastPathsForQuestion(q)) return {};
    const ans = findRepeatAnswer(state.chat_history as any, q);
    if (ans) return { answer: ans };
    return {};
  };
}
