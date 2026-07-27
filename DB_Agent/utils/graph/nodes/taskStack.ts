import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";
import { parseQueryPlan } from "../../nlu";
import { setRunMeta } from "../../query_metrics";
import { formatTaskStackProgress, parseTaskStackJson } from "../../task_stack";
import type { DbGraphState } from "../state";
import type { DbGraphCompileRefs, DbGraphDeps } from "../types";

export function createTaskStackNode(
  deps: Pick<DbGraphDeps, "progress">,
  refs: DbGraphCompileRefs,
): GraphNode<typeof DbGraphState> {
  const { progress } = deps;
  return async (state) => {
    const stack = parseTaskStackJson(String(state.task_stack_json || ""));
    if (!stack?.steps.length || !refs.compiledGraph) return {};
    const parts: string[] = [];
    let hist = (state.chat_history as BaseMessage[]) ?? [];
    try {
      progress?.(`任务栈：共 ${stack.steps.length} 步`);
    } catch {}
    for (let i = 0; i < stack.steps.length; i++) {
      const step = stack.steps[i]!;
      try {
        progress?.(formatTaskStackProgress(i + 1, stack.steps.length, step.label));
      } catch {}
      const sub = await refs.compiledGraph.invoke({
        question: step.question,
        chat_history: hist,
        manager_task_json: state.manager_task_json,
        session_id: state.session_id,
        bypass_task_stack: true,
      });
      const stepAns = String(sub?.answer ?? "").trim();
      parts.push(`【${step.label}】\n${stepAns || "（本步未返回结果）"}`);
      hist = [...hist, new HumanMessage(step.question), new AIMessage(stepAns)];
    }
    const plan = parseQueryPlan(state.query_plan_json);
    setRunMeta({
      path: "task_stack",
      task_stack_steps: stack.steps.length,
      data_domain: plan.data_domain,
      intent: "multi_step",
    });
    return { answer: parts.join("\n\n") };
  };
}
