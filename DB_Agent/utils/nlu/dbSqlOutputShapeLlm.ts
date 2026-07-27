/**
 * SQL 输出形态判定：明细/全字段 — LLM 优先；结构 fallback 仅读 QueryPlan / execution_shape。
 */
import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";
import type { QueryPlan } from "./query_plan";
import type { QueryExecutionShape } from "./dbQueryExecutionShapeLlm";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";

const ShapeSchema = z.object({
  wants_detail_rows: z.boolean().optional(),
  wants_full_fields: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const FULL_FIELD_MARKERS = [
  "详细", "每个字段", "所有字段", "全部字段", "完整字段", "全字段", "全部信息",
  "所有列", "全部列", "完整", "全部有用", "所有有用", "不遗漏", "不要遗漏",
] as const;

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

function includesAny(text: string, markers: readonly string[]): boolean {
  const t = String(text ?? "").replace(/\s+/g, "");
  return markers.some((m) => t.includes(m));
}

export function isDbSqlOutputShapeLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("sql_output_shape");
}

export function wantsFullFieldsStructural(question: string): boolean {
  return includesAny(question, FULL_FIELD_MARKERS);
}

export function wantsDetailRowsStructural(question: string): boolean {
  return hasExplicitRecordIdStructural(question);
}

export function planWantsFullRecordFieldsStructural(plan?: QueryPlan | null): boolean {
  return plan?.intent === "detail";
}

export function hasExplicitRecordIdStructural(question: string): boolean {
  const q = String(question ?? "");
  if (!q.includes("编号") && !q.toLowerCase().includes("id") && !q.includes("编码")) return false;
  return q.includes("=") || q.includes(":") || q.includes("：") || q.includes("为");
}

async function resolveShapeByLlm(
  model: ChatOpenAI | null,
  question: string,
  plan?: QueryPlan | null,
  executionShape?: QueryExecutionShape | null,
): Promise<{ wantsDetailRows: boolean; wantsFullFields: boolean } | null> {
  if (!model) return null;
  const q = String(question ?? "").trim().slice(0, 800);
  if (!q) return null;
  try {
    const res = await model.invoke([
      [
        "system",
        [
          "你是数据库查询输出形态判定器。判断用户是否需要明细行/全字段展示，只输出 JSON。勿用关键词表硬匹配。",
          "wants_detail_rows：需要枚举全部匹配行/子表明细（分别是什么、逐项列出），不是单个标量答案。",
          "wants_full_fields：需要完整字段/全部列/不遗漏字段。",
          "若 execution_shape=scalar_lookup 或用户只要单个属性值/名称 → wants_detail_rows=false。",
          "若 execution_shape=detail_rows → wants_detail_rows=true。",
          'schema: {"wants_detail_rows":boolean,"wants_full_fields":boolean,"confidence":number}',
        ].join("\n"),
      ],
      [
        "human",
        [
          `问题：${q}`,
          plan ? `QueryPlan.intent=${plan.intent}` : "",
          executionShape ? `execution_shape=${executionShape}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ],
    ]);
    const parsed = ShapeSchema.safeParse(safeJsonParse(String((res as { content?: string })?.content ?? "")));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null;
    return {
      wantsDetailRows: Boolean(parsed.data.wants_detail_rows),
      wantsFullFields: Boolean(parsed.data.wants_full_fields),
    };
  } catch {
    return null;
  }
}

export async function resolveWantsFullFields(model: ChatOpenAI | null, question: string): Promise<boolean> {
  const structural = wantsFullFieldsStructural(question);
  if (!isDbSqlOutputShapeLlmEnabled()) return structural;
  const llm = await resolveShapeByLlm(model, question);
  return llm?.wantsFullFields ?? structural;
}

export async function resolveWantsDetailRows(
  model: ChatOpenAI | null,
  question: string,
  plan?: QueryPlan | null,
  executionShape?: QueryExecutionShape | null,
): Promise<boolean> {
  if (executionShape === "scalar_lookup") return false;
  if (executionShape === "detail_rows") return true;
  if (plan?.intent === "detail") return true;

  if (isDbSqlOutputShapeLlmEnabled()) {
    const llm = await resolveShapeByLlm(model, question, plan, executionShape);
    if (llm) return llm.wantsDetailRows;
  }

  return hasExplicitRecordIdStructural(question);
}
