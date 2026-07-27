/**
 * 将 QueryPlan.filter_slots 映射为 SchemaLinkFilter（纯 LLM + schema 元数据，不用问句正则）。
 */
import { z } from "zod";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { QueryPlan } from "./query_plan";
import type { SchemaLinkFilter, TableColumnMeta } from "./dbSchemaLinkLlm";
import { inferSchemaFilterOp } from "./dbSchemaFilterOp";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";
import { clipText } from "./text";

const MapSchema = z.object({
  filters: z
    .array(
      z.object({
        table: z.string(),
        column: z.string(),
        op: z.enum(["=", "!=", "like", ">", "<", ">=", "<=", "in"]).default("like"),
        value: z.string(),
        field_hint: z.string().optional(),
      }),
    )
    .max(8)
    .default([]),
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

export function isDbFilterSlotMapLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("filter_slot_map");
}

function formatMetaBlock(metas: TableColumnMeta[]): string {
  const lines: string[] = [];
  for (const m of metas) {
    lines.push(`表 ${m.table}${m.table_comment ? ` // ${m.table_comment}` : ""}`);
    for (const c of m.columns.slice(0, 40)) {
      lines.push(`  - ${c.name}${c.comment ? ` // ${c.comment}` : ""} (${c.data_type})`);
    }
  }
  return clipText(lines.join("\n"), 3200);
}

function validateFilters(filters: SchemaLinkFilter[], metas: TableColumnMeta[]): SchemaLinkFilter[] {
  const colSet = new Map<string, Set<string>>();
  const tableSet = new Set(metas.map((m) => m.table));
  for (const m of metas) colSet.set(m.table, new Set(m.columns.map((c) => c.name)));
  return filters
    .filter((f) => tableSet.has(f.table) && colSet.get(f.table)?.has(f.column))
    .map((f) => ({
      ...f,
      op: f.op === "like" ? inferSchemaFilterOp(f.value, f.column) : f.op,
    }));
}

/** 检查 spec 是否已落实 plan 中的 filter_slots（结构性字符串比对，非问句正则） */
export function specCoversFilterSlots(specFilters: SchemaLinkFilter[], slots: QueryPlan["filters"]["slots"]): boolean {
  if (!slots.length) return true;
  const values = specFilters.map((f) => String(f.value ?? "").trim().toLowerCase()).filter(Boolean);
  if (!values.length) return false;
  return slots.every((s) => {
    const v = String(s.sql_match_value || s.value || "").trim().toLowerCase();
    if (!v) return true;
    return values.some((fv) => fv.includes(v) || v.includes(fv));
  });
}

export function scoreColumnForFieldHint(
  col: { name: string; comment: string },
  fieldHint: string,
  tableComment = "",
): number {
  const hint = String(fieldHint ?? "").trim().toLowerCase();
  if (hint.length < 2) return 0;
  const blob = `${col.name} ${col.comment} ${tableComment}`.toLowerCase();
  const comment = String(col.comment ?? "").trim().toLowerCase();
  let score = 0;
  if (blob.includes(hint) || (comment && hint.includes(comment))) {
    score = Math.min(hint.length, 20) + (comment ? 5 : 0);
  }
  for (const suffix of ["名称", "名字"]) {
    if (hint.endsWith(suffix)) {
      const stem = hint.slice(0, -suffix.length);
      if (stem.length >= 2 && blob.includes(stem)) score = Math.max(score, stem.length + 3);
    }
  }
  const hintWantsName =
    hint.includes("名称") || hint.includes("名字") || hint.includes("标题") || hint.endsWith("名");
  const hintWantsType = hint.includes("类型") || hint.includes("分类");
  const colIsType = comment.includes("类型") || comment.includes("分类") || /\btype\b|_type/.test(blob);
  const colIsName =
    comment.includes("名称") ||
    comment.includes("名字") ||
    comment.includes("标题") ||
    /\bname\b|_name\b|title/.test(blob);
  if (hintWantsName && colIsName) score += 14;
  if (hintWantsName && colIsType) score = Math.max(0, score - 18);
  if (!hintWantsType && colIsType && !colIsName) score = Math.max(0, score - 10);
  if ((hint.includes("题目") || hint.includes("题干")) && colIsName) score += 10;
  if ((hint.includes("题目") || hint.includes("题干")) && colIsType && !hintWantsType) score = Math.max(0, score - 12);
  return score;
}

/** 按 filter_slots / metrics 与 schema 注释对齐，为锚点表排序（无问句正则） */
export function rankAnchorTablesByPlanSlots(
  plan: QueryPlan,
  metas: TableColumnMeta[],
  preferredFirst: string[] = [],
): string[] {
  const scores = new Map<string, number>();
  for (const m of metas) scores.set(m.table, 0);
  for (const pref of preferredFirst) {
    if (pref && scores.has(pref)) scores.set(pref, (scores.get(pref) ?? 0) + 10);
  }
  for (const slot of plan.filters?.slots ?? []) {
    for (const meta of metas) {
      let tableScore = 0;
      for (const col of meta.columns) {
        tableScore = Math.max(tableScore, scoreColumnForFieldHint(col, slot.field_hint, meta.table_comment));
      }
      if (tableScore) scores.set(meta.table, (scores.get(meta.table) ?? 0) + tableScore);
    }
  }
  for (const meta of metas) {
    const blob = `${meta.table} ${meta.table_comment}`.toLowerCase();
    for (const m of plan.metrics ?? []) {
      const t = String(m ?? "").trim().toLowerCase();
      if (t.length >= 2 && blob.includes(t)) {
        scores.set(meta.table, (scores.get(meta.table) ?? 0) + 6);
      }
    }
  }
  return [...scores.entries()]
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
}

/** 用 filter_slots.field_hint 与 schema 列名/注释对齐（无 LLM、非问句正则） */
export function mapFilterSlotsStructural(
  plan: QueryPlan,
  metas: TableColumnMeta[],
  anchorTable: string,
): SchemaLinkFilter[] {
  const slots = plan.filters?.slots ?? [];
  if (!slots.length) return [];

  const out: SchemaLinkFilter[] = [];
  for (const slot of slots) {
    const value = String(slot.sql_match_value || slot.value || "").trim();
    if (!value) continue;

    const tablesToTry = [
      metas.find((m) => m.table === anchorTable),
      ...metas.filter((m) => m.table !== anchorTable),
    ].filter(Boolean) as TableColumnMeta[];

    let mapped: SchemaLinkFilter | null = null;
    for (const meta of tablesToTry) {
      const ranked = meta.columns
        .map((c) => ({ c, score: scoreColumnForFieldHint(c, slot.field_hint, meta.table_comment) }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0]?.score) {
        const col = ranked[0].c.name;
        mapped = { table: meta.table, column: col, op: inferSchemaFilterOp(value, col), value };
        break;
      }
    }
    if (mapped) out.push(mapped);
  }
  return validateFilters(out, metas);
}

export async function mapFilterSlotsToSchemaFilters(
  model: BaseLanguageModel | null,
  opts: {
    question: string;
    queryPlan?: QueryPlan | null;
    anchorTable: string;
    metas: TableColumnMeta[];
    existingFilters?: SchemaLinkFilter[];
  },
): Promise<SchemaLinkFilter[] | null> {
  if (!model || !isDbFilterSlotMapLlmEnabled()) return null;
  const slots = opts.queryPlan?.filters?.slots ?? [];
  if (!slots.length) return null;

  const slotLines = slots
    .map((s) => `- ${s.field_hint}：用户值=${s.value}；sql_match_value=${s.sql_match_value || s.value}`)
    .join("\n");
  const existing = (opts.existingFilters ?? [])
    .map((f) => `- ${f.table}.${f.column} ${f.op} ${f.value}`)
    .join("\n");

  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是数据库筛选条件映射器。将 QueryPlan.filter_slots 映射为具体表列与 SQL 比较值。",
          "只输出 JSON。按 schema 注释与语义理解，勿用关键词表或问句正则。",
          "规则：",
          "1) table/column 必须来自下方 schema。",
          "2) 优先在 anchor_table 上选列；必要时可选关联表。",
          "3) value 使用 filter_slots 中的 sql_match_value（若无则用 value）。",
          "4) sql_match_value 为完整字面值且无通配符时，名称类列（*_name/*_title）用 op=；数值/UUID 用 =；模糊片段才用 like。",
          "5) 每个 filter_slot 至少映射一条 filter。",
          "6) field_hint 含「名称/题目名/题干」时优先 *_name 列，勿选 *_type 类型/枚举列；结合列注释与样例值判断用户值是名称文本还是类型编码。",
          "7) 用户给出具体题目/对象名称时，筛选应落在名称列，不要误用类型列做 GROUP BY。",
          'schema: {"filters":[{"table":"","column":"","op":"like","value":"","field_hint":""}],"confidence":0-1}',
        ].join("\n"),
      ],
      [
        "human",
        clipText(
          [
            `问题：${opts.question}`,
            `anchor_table=${opts.anchorTable}`,
            opts.queryPlan?.metrics?.length ? `metrics：${opts.queryPlan.metrics.join("、")}` : "",
            `filter_slots：\n${slotLines}`,
            existing ? `已有 filters（可补充缺失项）：\n${existing}` : "",
            "",
            "Schema：",
            formatMetaBlock(opts.metas),
          ]
            .filter(Boolean)
            .join("\n"),
          4000,
        ),
      ],
    ]);
    const text =
      typeof (res as { content?: string })?.content === "string"
        ? String((res as { content?: string }).content ?? "")
        : "";
    const parsed = MapSchema.safeParse(safeJsonParse(text));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.45) return null;
    const mapped = parsed.data.filters.map((f) => ({
      table: String(f.table).trim(),
      column: String(f.column).trim(),
      op: f.op,
      value: String(f.value ?? "").trim(),
    }));
    return validateFilters(mapped, opts.metas);
  } catch {
    return null;
  }
}

export function mergeSchemaLinkFilters(
  existing: SchemaLinkFilter[],
  mapped: SchemaLinkFilter[],
): SchemaLinkFilter[] {
  const out = [...existing];
  const keys = new Set(existing.map((f) => `${f.table}.${f.column}`));
  for (const f of mapped) {
    const k = `${f.table}.${f.column}`;
    if (!keys.has(k)) {
      out.push(f);
      keys.add(k);
    }
  }
  return out;
}
