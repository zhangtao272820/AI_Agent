/**
 * detail_rows 通用明细记录：单表按条件筛后 SELECT 多列业务字段（非域专用快路径）。
 */
import type { QueryPlan } from "./query_plan";
import type { QueryExecutionShape } from "./dbQueryExecutionShapeLlm";
import type { SchemaLinkFilter, SchemaLinkSelect, SchemaLinkSpec, TableColumnMeta } from "./dbSchemaLinkLlm";
import { columnLooksLikeJsonIdArray } from "./dbSchemaLinkStructural";
import { scoreColumnAgainstMetrics } from "./dbSchemaLinkColumnScore";

const SKIP_COLS = new Set([
  "deleted",
  "is_deleted",
  "del_flag",
  "status",
  "create_by",
  "update_by",
  "is_yn_open",
  "create_time",
  "update_time",
  "created_at",
  "updated_at",
  "gmt_create",
  "gmt_modified",
]);

function columnNameLooksLikeId(name: string): boolean {
  const k = String(name ?? "").toLowerCase();
  return k === "id" || k.endsWith("_id") || k.startsWith("id_");
}

function columnLooksNumeric(dataType: string): boolean {
  const t = String(dataType ?? "").toLowerCase();
  return /int|decimal|numeric|float|double|real/.test(t);
}

/** 注释是否为业务时间（检测/测量等），而非空白「创建/更新时间」 */
function commentLooksLikeBusinessTime(comment: string): boolean {
  const c = String(comment ?? "").trim();
  if (!c) return false;
  if (/^(创建|更新|修改)时间$/.test(c)) return false;
  return /检测|测量|就诊|记录时间|业务时间|发生|开始|结束|采集/.test(c);
}

function isBusinessColumn(col: { name: string; comment: string; data_type: string }): boolean {
  if (columnNameLooksLikeId(col.name)) return false;
  if (SKIP_COLS.has(col.name.toLowerCase())) return false;
  if (columnLooksLikeJsonIdArray(col)) return false;
  return true;
}

export function planHasEntityOrSlotFilter(plan?: QueryPlan | null): boolean {
  if (!plan) return false;
  if ((plan.entities?.names?.length ?? 0) > 0) return true;
  const slots = plan.filters?.slots ?? [];
  if (slots.some((s) => String(s.value ?? s.field_hint ?? "").trim())) return true;
  return (plan.filters?.where?.filter(Boolean).length ?? 0) > 0;
}

/** 从锚点表挑选明细展示列（schema + metrics，非问句词表） */
export function pickDetailRecordColumns(
  meta: TableColumnMeta,
  plan: QueryPlan,
  maxCols = 12,
): SchemaLinkSelect[] {
  const metrics = plan.metrics ?? [];
  const ranked = meta.columns
    .filter(isBusinessColumn)
    .map((c) => {
      let score = scoreColumnAgainstMetrics(c, metrics, meta.table_comment);
      const name = c.name.toLowerCase();
      const comment = String(c.comment ?? "");
      // 仅业务时间加分；审计 create/update_time 已在 SKIP_COLS，不会进入
      if (commentLooksLikeBusinessTime(comment)) {
        score += 8;
      } else if (
        (name.includes("time") || name.includes("date") || comment.includes("时间") || comment.includes("日期")) &&
        !/create|update|gmt_/.test(name)
      ) {
        score += 4;
      }
      if (columnLooksNumeric(c.data_type)) score += 4;
      if (name.endsWith("_content") || comment.includes("内容") || comment.includes("结果")) score += 5;
      if (name.includes("title") || comment.includes("标题")) score += 6;
      if (name.includes("name") && (comment.includes("姓名") || comment.includes("名称") || comment.includes("章节"))) {
        score += 5;
      }
      return { c, score };
    })
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));

  const minCols = 3;
  const picked =
    ranked.filter((x) => x.score > 0).length >= minCols
      ? ranked.filter((x) => x.score > 0).slice(0, maxCols)
      : ranked.slice(0, Math.max(minCols, Math.min(maxCols, ranked.length)));

  if (!picked.length) return [];
  return picked.map((x) => ({ table: meta.table, column: x.c.name }));
}

export function inferSingleTableDetailRecordSpec(
  metas: TableColumnMeta[],
  plan: QueryPlan,
  filters: SchemaLinkFilter[],
  anchorTable: string,
): SchemaLinkSpec | null {
  if (!planHasEntityOrSlotFilter(plan)) return null;
  if (!filters.length) return null;
  const anchorMeta = metas.find((m) => m.table === anchorTable);
  if (!anchorMeta) return null;

  const select = pickDetailRecordColumns(anchorMeta, plan);
  if (select.length < 2) return null;

  const timeCol = anchorMeta.columns.find(
    (c) => isBusinessColumn(c) && commentLooksLikeBusinessTime(String(c.comment ?? "")),
  );

  return {
    mode: "single_table",
    anchor_table: anchorTable,
    filters,
    select,
    use_distinct: false,
    limit: Math.max(3, Math.min(15, plan.limit || 5)),
    confidence: 0.74,
    reason: "schema_detail_record_infer",
    result_cardinality: "enumerate_rows",
    order_by: timeCol ? [{ table: anchorTable, column: timeCol.name }] : undefined,
  };
}

/** LLM/结构 spec 仅 1 列时，按 schema 扩成明细多列；仅 detail_rows（显式 scalar 不扩） */
export function expandSpecForDetailRecord(
  spec: SchemaLinkSpec,
  metas: TableColumnMeta[],
  plan: QueryPlan,
  executionShape?: QueryExecutionShape | string | null,
): SchemaLinkSpec {
  // 显式 scalar / distinct 属性集合：禁止扩成明细多列（避免时间噪声进 SELECT）
  if (executionShape === "scalar_lookup") return spec;
  if (spec.mode === "json_array_join") return spec;
  if (spec.result_cardinality === "distinct_set" || spec.use_distinct) return spec;

  const wantDetail =
    executionShape === "detail_rows" ||
    plan.intent === "detail" ||
    spec.result_cardinality === "enumerate_rows";
  if (!wantDetail) return spec;
  if (spec.mode !== "single_table" && spec.mode !== "fk_join") return spec;
  if (spec.select.length >= 3) return spec;
  if (!planHasEntityOrSlotFilter(plan)) return spec;
  const meta = metas.find((m) => m.table === (spec.mode === "fk_join" ? spec.select[0]?.table : spec.anchor_table));
  if (!meta) return spec;
  const select = pickDetailRecordColumns(meta, plan);
  if (select.length < 2) return spec;
  return {
    ...spec,
    select,
    use_distinct: false,
    result_cardinality: "enumerate_rows",
    limit: Math.max(spec.limit || 0, Math.min(15, plan.limit || 5)),
    reason: spec.reason ? `${spec.reason}+detail_record_expand` : "detail_record_expand",
  };
}
