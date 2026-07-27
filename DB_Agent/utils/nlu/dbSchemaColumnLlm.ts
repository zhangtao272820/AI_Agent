/**
 * 统计 SQL 列选择：LLM 语义 + schema 名/注释结构性 fallback。
 */
import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";
import type { QueryPlan } from "./query_plan";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";

export type ColMeta = { name: string; comment: string };

const PickSchema = z.object({
  time_column: z.string().nullable().optional(),
  dimension_column: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const TIME_NAME_SUFFIXES = ["time", "date", "at", "on", "created", "updated", "check", "record"] as const;
const TIME_COMMENT_MARKERS = ["时间", "日期", "年月"] as const;
const DIM_NAME_TOKENS = [
  "type", "status", "category", "region", "gender", "sex", "age", "name", "crowd", "class", "level",
] as const;
const DIM_COMMENT_MARKERS = ["类型", "状态", "分类", "地区", "性别", "年龄", "人群"] as const;

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

export function isDbSchemaColumnLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("schema_column");
}

function nameLooksLikeTime(name: string): boolean {
  const n = name.toLowerCase();
  return TIME_NAME_SUFFIXES.some((s) => n.endsWith(s) || n.includes(`_${s}`));
}

function commentIncludesAny(comment: string, markers: readonly string[]): boolean {
  const c = String(comment ?? "");
  return markers.some((m) => c.includes(m));
}

function scoreColumn(col: ColMeta, hints: string[]): number {
  const blob = `${col.name} ${col.comment}`.toLowerCase();
  let score = 0;
  for (const h of hints) {
    const s = String(h ?? "").trim().toLowerCase();
    if (!s || s.length < 2) continue;
    if (blob.includes(s)) score += 10;
    if (col.name.toLowerCase().includes(s)) score += 6;
  }
  return score;
}

export function pickTimeColumnStructural(cols: ColMeta[]): string | null {
  for (const c of cols) {
    if (nameLooksLikeTime(c.name) || commentIncludesAny(c.comment, TIME_COMMENT_MARKERS)) return c.name;
  }
  for (const c of cols) {
    const n = c.name.toLowerCase();
    if (n.includes("datetime") || n.includes("timestamp")) return c.name;
  }
  return null;
}

export function columnLooksLikeTypeDim(col: ColMeta): boolean {
  const blob = `${col.name} ${col.comment}`.toLowerCase();
  return (
    String(col.comment ?? "").includes("类型") ||
    String(col.comment ?? "").includes("分类") ||
    /\btype\b|_type\b/.test(blob)
  );
}

export function dimHintsWantTypeColumn(hints: string[]): boolean {
  const blob = hints.join(" ");
  return blob.includes("类型") || blob.includes("分类") || blob.includes("分布");
}

export function pickDimensionColumnStructural(cols: ColMeta[], hints: string[]): string | null {
  const hintBlob = hints.join(" ");
  if (/性别/.test(hintBlob)) {
    // 优先列注释含「性别」的业务字段；避免仅凭英文名 Gender 压过档案表字段
    const byComment = cols.find((c) => commentIncludesAny(c.comment, ["性别"]));
    if (byComment) return byComment.name;
    const byName = cols.find((c) => c.name.toLowerCase().includes("gender"));
    if (byName) return byName.name;
  }
  const scored = cols
    .map((c) => {
      let s = scoreColumn(c, hints);
      if (columnLooksLikeTypeDim(c) && !dimHintsWantTypeColumn(hints)) s -= 18;
      return { c, s };
    })
    .filter((x) => x.s > 0 && !nameLooksLikeTime(x.c.name))
    .sort((a, b) => b.s - a.s);
  if (scored[0]?.c?.name) return scored[0].c.name;
  const fallback = cols.find(
    (c) =>
      DIM_NAME_TOKENS.some((t) => c.name.toLowerCase().includes(t)) ||
      commentIncludesAny(c.comment, DIM_COMMENT_MARKERS),
  );
  return fallback?.name ?? null;
}

export async function pickStatColumnsByLlm(
  model: ChatOpenAI | null,
  input: {
    table: string;
    columns: ColMeta[];
    queryPlan?: QueryPlan | null;
    question: string;
  },
): Promise<{ timeCol: string | null; dimCol: string | null } | null> {
  if (!model) return null;
  const cols = input.columns.slice(0, 40);
  if (!cols.length) return null;
  const planText = [
    ...(input.queryPlan?.dimensions ?? []),
    ...(input.queryPlan?.metrics ?? []),
    ...(input.queryPlan?.filters?.where ?? []),
    `intent=${input.queryPlan?.intent ?? "unknown"}`,
  ].join(" ");
  try {
    const colLines = cols.map((c) => `- ${c.name}${c.comment ? ` // ${c.comment}` : ""}`).join("\n");
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是 SQL 统计列选择器。根据表结构与查询计划，选出时间列与分组维度列，只输出 JSON。",
          "勿用关键词表硬匹配；按语义与列名/注释理解。",
          "time_column：趋势统计用的时间/日期列，无则 null。",
          "dimension_column：分布/分组维度列，须为表中存在的 column name，无则 null。",
          'schema: {"time_column":string|null,"dimension_column":string|null,"confidence":number}',
        ].join("\n"),
      ],
      [
        "human",
        [`表：${input.table}`, `问题：${String(input.question ?? "").slice(0, 400)}`, `计划：${planText.slice(0, 400)}`, "列：", colLines].join("\n"),
      ],
    ]);
    const parsed = PickSchema.safeParse(safeJsonParse(String((res as { content?: string })?.content ?? "")));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.45) return null;
    const names = new Set(cols.map((c) => c.name));
    const timeCol = parsed.data.time_column && names.has(parsed.data.time_column) ? parsed.data.time_column : null;
    const dimCol =
      parsed.data.dimension_column && names.has(parsed.data.dimension_column) ? parsed.data.dimension_column : null;
    if (!timeCol && !dimCol) return null;
    return { timeCol, dimCol };
  } catch {
    return null;
  }
}

export async function resolveStatColumns(
  model: ChatOpenAI | null,
  input: {
    table: string;
    columns: ColMeta[];
    queryPlan?: QueryPlan | null;
    question: string;
    dimHints: string[];
  },
): Promise<{ timeCol: string | null; dimCol: string | null }> {
  const structural = {
    timeCol: pickTimeColumnStructural(input.columns),
    dimCol: pickDimensionColumnStructural(input.columns, input.dimHints),
  };
  if (!isDbSchemaColumnLlmEnabled()) return structural;
  const llm = await pickStatColumnsByLlm(model, input);
  if (!llm) return structural;
  return {
    timeCol: llm.timeCol ?? structural.timeCol,
    dimCol: llm.dimCol ?? structural.dimCol,
  };
}
