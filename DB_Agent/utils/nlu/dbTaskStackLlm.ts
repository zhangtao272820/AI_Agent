/**
 * 多步查数任务栈：LLM 拆解「先…再…」类复合问句。
 */
import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";
import type { QueryPlan } from "./query_plan";
import type { TaskStackPlan, TaskStackStep } from "../task_stack";
import { splitSequentialQuestion } from "../task_stack_structural";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";

const StepSchema = z.object({
  label: z.string(),
  question: z.string(),
  intent_hint: z.enum(["detail", "aggregation", "trend", "comparison", "schema_help", "out_of_scope", "unknown"]).optional(),
});

const TaskStackSchema = z.object({
  has_stack: z.boolean(),
  steps: z.array(StepSchema).max(4).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

function safeJsonParse(text: string): unknown {
  const s = String(text ?? "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function isDbTaskStackLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("task_stack");
}

/** 结构性：仅识别「先…再/然后…」连接词，不做统计/明细关键词表 */
export function inferTaskStackStructural(question: string): TaskStackPlan | null {
  const q = String(question ?? "").trim();
  const seq = splitSequentialQuestion(q);
  if (!seq) return null;
  return {
    source_question: q,
    steps: [
      { label: "第一步", question: seq.first },
      { label: "第二步", question: seq.second },
    ],
  };
}

export async function extractTaskStackByLlm(
  model: ChatOpenAI | null,
  question: string,
  plan: QueryPlan,
): Promise<TaskStackPlan | null> {
  if (!model) return null;
  const q = String(question ?? "").trim();
  if (!q || q.length < 8) return null;
  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是数据库多步查询拆解器。判断用户是否要求分步执行（如先汇总再明细、先统计再列表），只输出 JSON。",
          "勿用关键词表硬匹配；按语义理解是否需要拆成 2-3 个子问句。",
          "has_stack=false：单一查询即可（含「按X分布/统计」类单步聚合，勿拆成多步）。",
          "has_stack=true：steps 每步 question 可独立执行，intent_hint 可选 detail|aggregation|trend|comparison。",
          'schema: {"has_stack":boolean,"steps":[{"label":string,"question":string,"intent_hint":string}],"confidence":number}',
        ].join("\n"),
      ],
      [
        "human",
        [`用户问题：${q.slice(0, 900)}`, `QueryPlan.intent=${plan.intent}`, `QueryPlan.metrics=${(plan.metrics ?? []).join("、") || "无"}`]
          .filter(Boolean)
          .join("\n"),
      ],
    ]);
    const parsed = TaskStackSchema.safeParse(safeJsonParse(String((res as { content?: string })?.content ?? "")));
    if (!parsed.success || !parsed.data.has_stack || Number(parsed.data.confidence ?? 0) < 0.5) return null;
    const steps: TaskStackStep[] = parsed.data.steps
      .map((s) => ({
        label: String(s.label ?? "").trim() || "子任务",
        question: String(s.question ?? "").trim(),
        intent_hint: s.intent_hint,
      }))
      .filter((s) => s.question.length >= 4);
    if (steps.length < 2) return null;
    return { source_question: q, steps: steps.slice(0, 3) };
  } catch {
    return null;
  }
}

/** 单一聚合/分布问句不应拆成任务栈（如「按性别分布」） */
export function isSingleAggregationQuery(plan: QueryPlan, question: string): boolean {
  if (!["aggregation", "trend", "comparison"].includes(plan.intent)) return false;
  const q = String(question ?? "").trim();
  if (/先.{2,40}(再|然后)/.test(q)) return false;
  if (/按.{1,16}(分布|统计|占比|分组|结构)/.test(q)) return true;
  if ((plan.dimensions?.length ?? 0) >= 1 && plan.intent === "aggregation") return true;
  return false;
}

export async function resolveTaskStack(
  model: ChatOpenAI | null,
  question: string,
  plan: QueryPlan,
): Promise<TaskStackPlan | null> {
  if (isSingleAggregationQuery(plan, question)) return null;
  const q = String(question ?? "").trim();
  // 单人明细查记录：勿 LLM 拆成多步（总管 multi 已负责 clean/code/report）
  if (
    plan.intent === "detail" &&
    (plan.entities?.names?.length ?? 0) === 1 &&
    !/先.{2,40}(再|然后|接着|之后)/.test(q)
  ) {
    return null;
  }
  const structural = inferTaskStackStructural(question);
  if (structural) return structural;
  if (!isDbTaskStackLlmEnabled()) return null;
  return extractTaskStackByLlm(model, question, plan);
}
