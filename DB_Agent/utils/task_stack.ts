/**
 * P6 任务栈：识别「先统计再明细」等多步查数，拆解为顺序子任务。
 * 业务拆解优先 LLM（dbTaskStackLlm）；此处仅保留结构性「先…再…」与 JSON 解析。
 */
import { clipText } from "./nlu/text";
import type { QueryPlan } from "./nlu/query_plan";
import { DB_AGENT_DEFAULTS } from "./db_agent_env";
import { splitSequentialQuestion } from "./task_stack_structural";

export type TaskStackStep = {
  label: string;
  question: string;
  intent_hint?: QueryPlan["intent"];
};

export type TaskStackPlan = {
  steps: TaskStackStep[];
  source_question: string;
};

/** @deprecated 请用 resolveTaskStack（LLM）；同步仅识别「先…再…」结构 */
export function detectTaskStack(question: string, _plan: QueryPlan): TaskStackPlan | null {
  if (!DB_AGENT_DEFAULTS.enableTaskStack) return null;
  const q = String(question ?? "").trim();
  if (!q || q.length < 8) return null;

  const seq = splitSequentialQuestion(q);
  if (seq) {
    return {
      source_question: q,
      steps: [
        { label: "第一步", question: seq.first },
        { label: "第二步", question: seq.second },
      ],
    };
  }

  return null;
}

export function parseTaskStackJson(raw: string): TaskStackPlan | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  try {
    const o = JSON.parse(text) as TaskStackPlan;
    if (!Array.isArray(o?.steps) || o.steps.length < 2) return null;
    const steps = o.steps
      .map((s) => ({
        label: String(s?.label ?? "").trim() || "子任务",
        question: String(s?.question ?? "").trim(),
        intent_hint: s?.intent_hint,
      }))
      .filter((s) => s.question.length >= 4);
    if (steps.length < 2) return null;
    return { source_question: String(o.source_question ?? ""), steps };
  } catch {
    return null;
  }
}

export function formatTaskStackProgress(stepIndex: number, total: number, label: string) {
  return clipText(`多步查询 ${stepIndex}/${total}：${label}`, 80);
}
