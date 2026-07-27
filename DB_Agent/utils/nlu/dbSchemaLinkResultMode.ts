/**
 * Schema Link 结果形态（DIN-SQL / MAC-SQL 风格）：模型判定返回行数语义，非业务关键词。
 */
import type { QueryExecutionShape } from "./dbQueryExecutionShapeLlm";
import type { SchemaLinkSpec } from "./dbSchemaLinkLlm";

export type ResultCardinality = "single" | "distinct_set" | "enumerate_rows";

export function cardinalityFromExecutionShape(
  shape?: QueryExecutionShape | null,
): ResultCardinality | null {
  switch (shape) {
    case "detail_rows":
      return "enumerate_rows";
    case "scalar_lookup":
      return "single";
    case "distribution":
    case "trend":
      return "distinct_set";
    default:
      return null;
  }
}

/** 将 execution_shape / LLM result_cardinality 合并进 SchemaLinkSpec（通用，非域词表） */
export function mergeResultModeIntoSpec(
  spec: SchemaLinkSpec,
  opts: {
    executionShape?: QueryExecutionShape | null;
    resultCardinality?: ResultCardinality | null;
    planLimit?: number;
  },
): SchemaLinkSpec {
  const explicit = opts.resultCardinality ?? spec.result_cardinality ?? null;
  // JSON 数组关联 / 已标 distinct_set：不被 scalar_lookup→single 或 detail_rows→enumerate 覆盖
  const keepDistinctSet =
    explicit === "distinct_set" ||
    (spec.mode === "json_array_join" && explicit !== "enumerate_rows" && explicit !== "single") ||
    (spec.mode === "json_array_join" && !explicit) ||
    (Boolean(spec.use_distinct) && spec.mode === "json_array_join");

  if (keepDistinctSet) {
    return {
      ...spec,
      result_cardinality: "distinct_set",
      use_distinct: true,
      limit: Math.min(Math.max(spec.limit || 15, opts.planLimit || 0), 15),
    };
  }

  const cardinality =
    explicit ??
    cardinalityFromExecutionShape(opts.executionShape) ??
    (spec.use_distinct ? "distinct_set" : "single");

  if (cardinality === "enumerate_rows") {
    const baseLimit = Math.max(spec.limit || 0, opts.planLimit || 0, 20);
    return {
      ...spec,
      result_cardinality: "enumerate_rows",
      use_distinct: false,
      limit: Math.min(30, baseLimit),
    };
  }
  if (cardinality === "distinct_set") {
    return {
      ...spec,
      result_cardinality: "distinct_set",
      use_distinct: true,
      limit: Math.min(spec.limit || 15, 15),
    };
  }
  return {
    ...spec,
    result_cardinality: "single",
    use_distinct: spec.use_distinct ?? false,
    limit: Math.min(spec.limit || 10, 10),
  };
}

/**
 * detail_rows 下是否应用「列数不足」否决。
 * JSON 关联 DISTINCT 属性集合天然单列，不得当作不完整明细丢掉。
 */
export function shouldRejectIncompleteDetailLink(
  executionShape?: QueryExecutionShape | null,
  spec?: Pick<SchemaLinkSpec, "mode" | "result_cardinality" | "use_distinct"> | null,
): boolean {
  if (executionShape !== "detail_rows") return false;
  if (!spec) return true;
  if (spec.mode === "json_array_join") return false;
  if (spec.result_cardinality === "distinct_set") return false;
  if (spec.use_distinct) return false;
  return true;
}

export function isEnumerateRowsMode(
  executionShape?: QueryExecutionShape | null,
  spec?: Pick<SchemaLinkSpec, "result_cardinality"> | null,
): boolean {
  return executionShape === "detail_rows" || spec?.result_cardinality === "enumerate_rows";
}

export function enumerateRowLimit(planLimit?: number): number {
  return Math.max(15, Math.min(30, planLimit || 20));
}

function isNoiseResultKey(k: string): boolean {
  const s = String(k || "").trim().toLowerCase();
  if (!s) return true;
  if (s === "id" || s.endsWith("_id") || s.startsWith("id_") || s.includes("编号")) return true;
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

/** detail_rows 链路：结果是否只有姓名等单列，不足以当业务明细 */
export function detailEnumerateRowsLookIncomplete(rows: any[]): boolean {
  if (!rows?.length) return true;
  const r = rows[0];
  if (!r || typeof r !== "object") return true;
  let cols = 0;
  for (const k of Object.keys(r)) {
    if (isNoiseResultKey(k)) continue;
    const v = (r as any)[k];
    if (v === null || v === undefined || String(v).trim() === "") continue;
    cols += 1;
  }
  return cols < 2;
}

/** 枚举明细展示前去重：按非 ID 业务列指纹合并（JOIN 多父行时防重复） */
export function dedupeEnumerateRows(rows: any[]): any[] {
  if (!rows?.length || rows.length < 2) return rows ?? [];
  const idKey = (k: string) => /(^id$|_id$|_uuid$)/i.test(k);
  const out: any[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const keys = Object.keys(r)
      .filter((k) => !idKey(k))
      .sort();
    const fp = keys.map((k) => `${k}=${String((r as any)[k] ?? "")}`).join("|");
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(r);
  }
  return out.length ? out : rows;
}
