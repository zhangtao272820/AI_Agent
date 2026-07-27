import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { DataSource } from "typeorm";
import type { QueryPlan } from "../../nlu/query_plan";
import { guessTablesFromSql } from "../../sql_plan_guard";
import { formatFieldValueForUser } from "../../display_values";
import { pickDisplayColumnsByLlm } from "../../nlu/dbResultColumnLlm";
import { pickColumnsByPlanMetrics, formatSingleScalarValue, planRequestsContactReveal } from "../../nlu/dbAnswerFormat";
import { shouldRunResultColumnLlm } from "../../nlu/dbModelRouter";
import {
  isEnumerateRowsMode,
  dedupeEnumerateRows,
  enumerateRowLimit,
} from "../../nlu/dbSchemaLinkResultMode";
import type { QueryExecutionShape } from "../../nlu/dbQueryExecutionShapeLlm";
import type { SchemaGroundResult } from "../../schema_ground";
import { sanitizeAssistantText, sanitizeAssistantTextForPlan } from "../../text";

function isSensitiveKey(k: string, opts?: { allowContact?: boolean }) {
  if (opts?.allowContact && /(phone|mobile|tel)/i.test(k)) return false;
  return /(id_card|idcard|身份证|phone|mobile|tel|password|passwd|secret|token)/i.test(k);
}

function isIdKey(k: string) {
  const s = String(k || "").trim().toLowerCase();
  if (!s) return true;
  if (s === "id") return true;
  if (s.endsWith("_id")) return true;
  if (s.startsWith("id_")) return true;
  if (s.includes("编号")) return true;
  return false;
}

export function isAuditNoiseKey(k: string) {
  const s = String(k || "").trim().toLowerCase();
  return [
    "create_by",
    "update_by",
    "deleted",
    "del_flag",
    "is_deleted",
    "create_time",
    "update_time",
    "created_at",
    "updated_at",
    "gmt_create",
    "gmt_modified",
  ].includes(s);
}

export async function loadTableComments(ds: DataSource, tables: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of Array.from(new Set(tables.filter(Boolean)))) {
    try {
      const rows = await ds.query(
        `SELECT COALESCE(table_comment,'') AS comment FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
        [table],
      );
      if (Array.isArray(rows) && rows[0]) out[table] = String((rows[0] as any).comment ?? "");
    } catch {
      /* ignore */
    }
  }
  return out;
}

async function loadColumnMeta(ds: DataSource, tables: string[], preferTable?: string) {
  const commentByName: Record<string, string> = {};
  const dataTypeByName: Record<string, string> = {};
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  const uniq = Array.from(new Set(tables.filter(Boolean)));
  const ordered = preferTable && uniq.includes(preferTable)
    ? [preferTable, ...uniq.filter((t) => t !== preferTable)]
    : uniq;
  for (const table of ordered) {
    try {
      const cols = await ds.query(
        `SELECT column_name AS name, COALESCE(column_comment,'') AS comment, LOWER(data_type) AS data_type
         FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ?
         ORDER BY ordinal_position`,
        [table],
      );
      if (!Array.isArray(cols)) continue;
      for (const r of cols as any[]) {
        const n = String(r?.name ?? "").trim();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        orderedKeys.push(n);
        commentByName[n] = String(r?.comment ?? "");
        dataTypeByName[n] = String(r?.data_type ?? "").trim();
      }
    } catch {
      /* ignore */
    }
  }
  return { commentByName, dataTypeByName, orderedKeys };
}

export function rowsLookEmpty(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return true;
  return false;
}

export async function formatRowsForUser(
  ds: DataSource,
  rows: any[],
  opts: { sql: string; schemaGround?: SchemaGroundResult | null; maxRows?: number },
): Promise<string> {
  if (!rows?.length) return "";
  const maxRows = opts.maxRows ?? 15;
  const slice = rows.slice(0, maxRows);
  const judgePrimary = opts.schemaGround?.table_judge?.primary_tables ?? [];
  const candidates = opts.schemaGround?.candidate_tables ?? [];
  const sqlTables = guessTablesFromSql(opts.sql);
  const tables = Array.from(new Set([...sqlTables, ...judgePrimary, ...candidates.slice(0, 4)]));
  const preferTable = sqlTables[0] || judgePrimary[0] || candidates[0];
  const { commentByName, dataTypeByName, orderedKeys } = await loadColumnMeta(ds, tables, preferTable);

  const lines: string[] = [];
  for (let i = 0; i < slice.length; i++) {
    const r = slice[i];
    if (!r || typeof r !== "object") continue;
    const allKeys = Object.keys(r);
    const filtered = allKeys.filter((k) => !isSensitiveKey(k) && !isIdKey(k) && !isAuditNoiseKey(k));
    const schemaOrdered = orderedKeys.length ? orderedKeys.filter((k) => filtered.includes(k)) : [];
    const rest = filtered.filter((k) => !schemaOrdered.includes(k)).sort((a, b) => a.localeCompare(b));
    const picked = [...schemaOrdered, ...rest];

    const itemLines: string[] = [];
    for (const k of picked) {
      const raw = (r as any)[k];
      if (raw === null || raw === undefined || String(raw).trim() === "") continue;
      const label = String(commentByName[k] || k).trim();
      const shown = formatFieldValueForUser(k, commentByName[k] || "", dataTypeByName[k] || "", raw);
      itemLines.push(`- ${label}：${shown}`);
    }
    if (itemLines.length) {
      lines.push(`记录 ${i + 1}：`);
      lines.push(...itemLines);
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}

/** 属性/单值查询：去重合并为一句回答，避免「20 条重复记录」 */
async function formatScalarLookupAnswer(
  ds: DataSource,
  rows: any[],
  opts: {
    sql: string;
    schemaGround?: SchemaGroundResult | null;
    queryPlan?: QueryPlan | null;
    question?: string;
    model?: BaseLanguageModel | null;
  },
): Promise<string> {
  if (!rows?.length) return "";
  const judgePrimary = opts.schemaGround?.table_judge?.primary_tables ?? [];
  const candidates = opts.schemaGround?.candidate_tables ?? [];
  const sqlTables = guessTablesFromSql(opts.sql);
  const tables = Array.from(new Set([...sqlTables, ...judgePrimary, ...candidates.slice(0, 4)]));
  const preferTable = sqlTables[0] || judgePrimary[0] || candidates[0];
  const { commentByName, dataTypeByName } = await loadColumnMeta(ds, tables, preferTable);

  const metricHints = opts.queryPlan?.metrics ?? [];
  const allowContact = planRequestsContactReveal(opts.queryPlan);
  const valueSets = new Map<string, Set<string>>();
  const keyByLabel = new Map<string, string>();

  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    for (const k of Object.keys(r)) {
      if (isSensitiveKey(k, { allowContact }) || isIdKey(k) || isAuditNoiseKey(k)) continue;
      const raw = (r as any)[k];
      if (raw === null || raw === undefined || String(raw).trim() === "") continue;
      const shown = formatFieldValueForUser(k, commentByName[k] || "", dataTypeByName[k] || "", raw);
      if (!shown || shown.length > 500) continue;
      const label = String(commentByName[k] || k).trim();
      if (!valueSets.has(label)) {
        valueSets.set(label, new Set());
        keyByLabel.set(label, k);
      }
      valueSets.get(label)!.add(shown);
    }
  }

  if (!valueSets.size) return "";

  const available = [...valueSets.entries()].map(([label]) => ({
    key: keyByLabel.get(label) || label,
    label,
  }));

  const planPicked = pickColumnsByPlanMetrics(opts.queryPlan, available);
  const pickedKeys =
    !planPicked?.length &&
    shouldRunResultColumnLlm(opts.queryPlan, available.length) &&
    opts.model &&
    opts.question
      ? await pickDisplayColumnsByLlm(opts.model, {
          question: opts.question,
          queryPlan: opts.queryPlan,
          available,
        })
      : planPicked;
  const pickedLabels = pickedKeys?.length
    ? available.filter((a) => pickedKeys.includes(a.key)).map((a) => a.label)
    : null;

  const lines: string[] = [];
  // 兜底前再滤：标签侧勿保留「创建时间/更新时间」等审计注释
  const filteredKeys = [...valueSets.keys()].filter((label) => {
    const key = keyByLabel.get(label) || "";
    return !isAuditNoiseKey(key) && !/(创建|更新)时间/.test(label);
  });
  const labelsToShow = pickedLabels?.length
    ? pickedLabels.filter((label) => filteredKeys.includes(label) || !/(创建|更新)时间/.test(label))
    : metricHints.length
      ? filteredKeys
          .filter((label) => metricHints.some((m) => label.includes(m) || m.includes(label)))
          .slice(0, 3)
      : filteredKeys.slice(0, 3);

  if (labelsToShow.length === 1 && valueSets.get(labelsToShow[0]!)?.size === 1) {
    const val = [...(valueSets.get(labelsToShow[0]!) ?? [])][0]!;
    // 单列结果优先进列注释标签；勿用可能错位的 plan.metrics（如筛字段「课程名称」）盖住目标列
    return `${labelsToShow[0]}：${val}`;
  }

  for (const label of labelsToShow.length ? labelsToShow : [...valueSets.keys()].slice(0, 3)) {
    const vals = [...(valueSets.get(label) ?? [])];
    if (!vals.length) continue;
    lines.push(vals.length === 1 ? `${label}：${vals[0]}` : `${label}：${vals.join("、")}`);
  }
  return lines.join("\n").trim();
}

/** 聚合结果行（gender/count 等）→ 分布文案，避免「找到 N 条相关记录」 */
function formatDistributionRows(rows: any[]): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const lines: string[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const keys = Object.keys(r);
    const countKey = keys.find((k) => /^(count|cnt|total|num|数量|人数)$/i.test(k));
    const dimKey = keys.find((k) => k !== countKey && !/^id$/i.test(k));
    if (!dimKey || countKey == null) continue;
    const dim = String((r as any)[dimKey] ?? "未知").trim() || "未知";
    const n = Number((r as any)[countKey]);
    if (!Number.isFinite(n)) continue;
    lines.push(`- ${dim}：${n}`);
  }
  if (!lines.length || lines.length !== rows.length) return null;
  return lines.join("\n");
}

/** 明细结果若仅含性别码/标签多行 → 折叠为分布计数（结果结构判定，不读用户原话） */
function collapseGenderCodeDetailRows(rows: any[]): string | null {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const keys = Object.keys(rows[0] ?? {}).filter((k) => k && !/^id$/i.test(k));
  if (keys.length !== 1) return null;
  const k = keys[0]!;
  const keyL = k.toLowerCase();
  const looksGender =
    keyL.includes("gender") ||
    keyL.includes("sex") ||
    k.includes("性别");
  if (!looksGender) return null;
  const mapGender = (raw: unknown): string | null => {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    if (s === "1" || s === "男" || /男/.test(s) && !/女/.test(s)) return "男";
    if (s === "2" || s === "女" || /女/.test(s)) return "女";
    if (s === "0" || /未知/.test(s)) return "未知";
    const m = s.match(/[（(]([012])[）)]/);
    if (m?.[1] === "1") return "男";
    if (m?.[1] === "2") return "女";
    if (m?.[1] === "0") return "未知";
    return null;
  };
  const counts = new Map<string, number>();
  for (const r of rows) {
    const g = mapGender((r as any)[k]);
    if (!g) return null;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  if (counts.size < 1) return null;
  const order = ["男", "女", "未知"];
  const lines = order.filter((g) => counts.has(g)).map((g) => `- ${g}：${counts.get(g)}`);
  for (const [g, n] of counts) {
    if (!order.includes(g)) lines.push(`- ${g}：${n}`);
  }
  return lines.length ? lines.join("\n") : null;
}

/** 多行且≥2 业务列 → 应按行走注释明细，勿列聚合 */
function rowsLookLikeMultiColBusinessDetail(rows: any[]): boolean {
  if (!Array.isArray(rows) || rows.length < 2) return false;
  const r = rows[0];
  if (!r || typeof r !== "object") return false;
  let cols = 0;
  for (const k of Object.keys(r)) {
    if (isAuditNoiseKey(k) || isIdKey(k) || isSensitiveKey(k)) continue;
    const v = (r as any)[k];
    if (v === null || v === undefined || String(v).trim() === "") continue;
    cols += 1;
  }
  return cols >= 2;
}

async function formatAnswerFromRows(
  ds: DataSource,
  rows: any[],
  opts: {
    sql: string;
    schemaGround?: SchemaGroundResult | null;
    queryPlan?: QueryPlan | null;
    executionShape?: QueryExecutionShape | null;
    maxRows?: number;
    question?: string;
    model?: BaseLanguageModel | null;
  },
): Promise<{ body: string; mode: "scalar" | "detail" | "distribution" }> {
  const shape = opts.executionShape;
  const hasFilters =
    (opts.queryPlan?.filters?.where?.length ?? 0) > 0 || (opts.queryPlan?.filters?.slots?.length ?? 0) > 0;
  const multiColDetail =
    shape === "detail_rows" ||
    isEnumerateRowsMode(shape) ||
    rowsLookLikeMultiColBusinessDetail(rows);
  const scalar =
    !multiColDetail &&
    !isEnumerateRowsMode(shape) &&
    (shape === "scalar_lookup" ||
      (shape !== "detail_rows" &&
        opts.queryPlan?.intent === "aggregation" &&
        !(opts.queryPlan?.dimensions?.length) &&
        (opts.queryPlan?.metrics?.length ?? 0) > 0 &&
        hasFilters));

  if (scalar) {
    const body = await formatScalarLookupAnswer(ds, rows, {
      sql: opts.sql,
      schemaGround: opts.schemaGround,
      queryPlan: opts.queryPlan,
      question: opts.question,
      model: opts.model,
    });
    if (body) return { body, mode: "scalar" };
  }

  if (shape === "distribution" || shape === "trend" || ((opts.queryPlan?.dimensions?.length ?? 0) > 0 && shape !== "detail_rows")) {
    const dist = formatDistributionRows(rows);
    if (dist) return { body: dist, mode: "distribution" };
  }

  // 结果仅含性别码多行时折叠为分布计数（防明细包装泄漏注释）
  const collapsed = collapseGenderCodeDetailRows(rows);
  if (collapsed) return { body: collapsed, mode: "distribution" };

  const body = await formatRowsForUser(ds, rows, {
    sql: opts.sql,
    schemaGround: opts.schemaGround,
    maxRows: opts.maxRows,
  });
  return { body, mode: "detail" };
}

export function wrapSqlDirectAnswer(
  body: string,
  rowCount: number,
  mode: "scalar" | "detail" | "distribution",
): string {
  if (!body) return "查询已完成，但未返回可展示字段。";
  if (mode === "scalar" || mode === "distribution") return body;
  return `根据您的查询，找到 ${rowCount} 条相关记录：\n\n${body}`;
}

export function selectRowLimit(executionShape?: QueryExecutionShape | null): number {
  if (executionShape === "detail_rows") return enumerateRowLimit();
  return executionShape === "scalar_lookup" ? 10 : 20;
}

/** 将 question/model 注入 buildSqlDirectAnswer 的公共参数 */
export function answerOpts(
  params: {
    question: string;
    model: BaseLanguageModel;
    formatModel?: BaseLanguageModel | null;
    queryPlan?: QueryPlan | null;
    schemaGround?: SchemaGroundResult | null;
    executionShape?: QueryExecutionShape | null;
  },
  sql: string,
  overrides?: { executionShape?: QueryExecutionShape | null },
) {
  return {
    sql,
    schemaGround: params.schemaGround,
    queryPlan: params.queryPlan,
    executionShape: overrides?.executionShape ?? params.executionShape,
    question: params.question,
    model: params.formatModel ?? params.model,
  };
}

export async function buildSqlDirectAnswer(
  ds: DataSource,
  rows: any[],
  opts: {
    sql: string;
    schemaGround?: SchemaGroundResult | null;
    queryPlan?: QueryPlan | null;
    executionShape?: QueryExecutionShape | null;
    maxRows?: number;
    question?: string;
    model?: BaseLanguageModel | null;
  },
): Promise<string> {
  const displayRows = isEnumerateRowsMode(opts.executionShape) ? dedupeEnumerateRows(rows) : rows;
  const formatted = await formatAnswerFromRows(ds, displayRows, opts);
  return sanitizeAssistantTextForPlan(
    wrapSqlDirectAnswer(formatted.body, displayRows.length, formatted.mode),
    opts.queryPlan,
  );
}
