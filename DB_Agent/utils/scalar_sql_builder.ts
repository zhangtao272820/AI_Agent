/**
 * 将 SchemaLinkSpec 编译为 MySQL SELECT（含 JSON_TABLE 展开，MySQL 8+）。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { DataSource } from "typeorm";
import type { QueryPlan } from "./nlu/query_plan";
import type { SchemaGroundResult } from "./schema_ground";
import type { QueryExecutionShape } from "./nlu/dbQueryExecutionShapeLlm";
import type { SchemaLinkFilter, SchemaLinkSpec } from "./nlu/dbSchemaLinkLlm";
import { linkSchemaForScalarQuery } from "./nlu/dbSchemaLinkLlm";
import { mergeResultModeIntoSpec, dedupeEnumerateRows, isEnumerateRowsMode } from "./nlu/dbSchemaLinkResultMode";
import { mapFilterSlotsToSchemaFilters } from "./nlu/dbFilterSlotMapLlm";
import { loadTableColumnMeta, expandMetasForJsonArrayJoins } from "./nlu/dbSchemaLinkLlm";
import {
  enforceSelectLimit,
  injectMysqlMaxExecutionTimeHint,
  isReadOnlySelectSql,
} from "./sql_safety";
import { repairSqlWithLlm } from "./sql_repair";

function quoteId(id: string) {
  const s = String(id ?? "").trim();
  if (s.includes(".")) {
    const [a, b] = s.split(".", 2);
    return `\`${a.replace(/`/g, "")}\`.\`${b.replace(/`/g, "")}\``;
  }
  return `\`${s.replace(/`/g, "")}\``;
}

function tableAlias(table: string) {
  const parts = table.split("_").filter(Boolean);
  if (parts.length >= 2) return parts.map((p) => p[0]).join("").slice(0, 4) || "t";
  return table.slice(0, 2) || "t";
}

function compileFilter(f: SchemaLinkFilter, aliases: Map<string, string>): string | null {
  const alias = aliases.get(f.table) ?? f.table;
  const col = `${quoteId(alias)}.${quoteId(f.column)}`;
  const v = String(f.value ?? "").replace(/'/g, "''");
  if (!v && f.op !== "like") return null;
  switch (f.op) {
    case "like":
      return `${col} LIKE ${v.includes("%") ? `'${v}'` : `'%${v}%'`}`;
    case "in":
      return `${col} IN (${v.split(/[,，]/).map((x) => `'${x.trim()}'`).join(", ")})`;
    case "=":
    case "!=":
    case ">":
    case "<":
    case ">=":
    case "<=":
      return `${col} ${f.op} '${v}'`;
    default:
      return null;
  }
}

export function compileSchemaLinkToSql(spec: SchemaLinkSpec): { ok: true; sql: string } | { ok: false; reason: string } {
  if (!spec.select.length) return { ok: false, reason: "no_select" };

  const aliases = new Map<string, string>();
  aliases.set(spec.anchor_table, tableAlias(spec.anchor_table));

  const distinct = spec.use_distinct ? "DISTINCT " : "";
  const selectParts = spec.select.map((s) => {
    const alias = aliases.get(s.table) ?? tableAlias(s.table);
    if (!aliases.has(s.table)) aliases.set(s.table, alias);
    const col = `${quoteId(alias)}.${quoteId(s.column)}`;
    return s.alias ? `${col} AS ${quoteId(s.alias)}` : col;
  });

  const anchorAlias = aliases.get(spec.anchor_table)!;
  const parts: string[] = [`SELECT ${distinct}${selectParts.join(", ")}`, `FROM ${quoteId(spec.anchor_table)} ${quoteId(anchorAlias)}`];

  if (spec.mode === "json_array_join" && spec.json_array_join) {
    const j = spec.json_array_join;
    const fromAlias = aliases.get(j.from_table) ?? anchorAlias;
    const toAlias = tableAlias(j.to_table);
    aliases.set(j.to_table, toAlias);
    parts.push(
      `JOIN JSON_TABLE(CAST(${quoteId(fromAlias)}.${quoteId(j.json_column)} AS JSON), '$[*]' COLUMNS (linked_id BIGINT PATH '$')) jt ON TRUE`,
    );
    parts.push(`JOIN ${quoteId(j.to_table)} ${quoteId(toAlias)} ON ${quoteId(toAlias)}.${quoteId(j.to_column)} = jt.linked_id`);
  } else if (spec.mode === "fk_join" && spec.fk_joins?.length) {
    for (const j of spec.fk_joins) {
      const fromA = aliases.get(j.from_table) ?? tableAlias(j.from_table);
      const toA = aliases.get(j.to_table) ?? tableAlias(j.to_table);
      aliases.set(j.from_table, fromA);
      aliases.set(j.to_table, toA);
      parts.push(
        `INNER JOIN ${quoteId(j.to_table)} ${quoteId(toA)} ON ${quoteId(fromA)}.${quoteId(j.from_column)} = ${quoteId(toA)}.${quoteId(j.to_column)}`,
      );
    }
  }

  const whereParts = spec.filters.map((f) => compileFilter(f, aliases)).filter(Boolean) as string[];
  if (whereParts.length) parts.push(`WHERE ${whereParts.join(" AND ")}`);

  if (spec.order_by?.length) {
    const orderParts = spec.order_by
      .map((o) => {
        const alias = aliases.get(o.table) ?? tableAlias(o.table);
        aliases.set(o.table, alias);
        return `${quoteId(alias)}.${quoteId(o.column)}`;
      })
      .filter(Boolean);
    if (orderParts.length) parts.push(`ORDER BY ${orderParts.join(", ")}`);
  }

  const maxLimit = spec.result_cardinality === "enumerate_rows" || (spec.mode === "fk_join" && !spec.use_distinct) ? 30 : 20;
  parts.push(`LIMIT ${Math.max(1, Math.min(maxLimit, spec.limit || 10))}`);
  const sql = parts.join(" ");
  if (!/\bfrom\b/i.test(sql)) return { ok: false, reason: "invalid_sql" };
  return { ok: true, sql };
}

export type ScalarLinkedResult =
  | {
      ok: true;
      sql: string;
      rows: any[];
      spec_reason?: string;
      mode?: SchemaLinkSpec["mode"];
      result_cardinality?: SchemaLinkSpec["result_cardinality"];
      use_distinct?: boolean;
    }
  | { ok: false; reason: string };

export async function tryScalarSchemaLinkedQuery(params: {
  model: BaseLanguageModel;
  ds: DataSource;
  question: string;
  queryPlan?: QueryPlan | null;
  schemaGround?: SchemaGroundResult | null;
  executionShape?: QueryExecutionShape | null;
}): Promise<ScalarLinkedResult> {
  const shape = params.executionShape;
  const plan = params.queryPlan;
  const scalar =
    shape === "scalar_lookup" ||
    shape === "detail_rows" ||
    (plan?.intent === "aggregation" &&
      !(plan?.dimensions?.length) &&
      (plan?.metrics?.length ?? 0) > 0 &&
      ((plan?.filters?.where?.length ?? 0) > 0 ||
        (plan?.filters?.slots?.length ?? 0) > 0 ||
        (plan?.entities?.names?.length ?? 0) > 0));
  if (!scalar) return { ok: false, reason: "not_scalar" };

  let spec = await linkSchemaForScalarQuery(params.model, params.ds, {
    question: params.question,
    queryPlan: plan,
    schemaGround: params.schemaGround,
    executionShape: shape ?? "scalar_lookup",
  });
  if (!spec) return { ok: false, reason: "link_failed" };

  spec = mergeResultModeIntoSpec(spec, {
    executionShape: shape,
    resultCardinality: spec.result_cardinality,
    planLimit: plan?.limit,
  });

  let compiled = compileSchemaLinkToSql(spec);
  if (!compiled.ok) return { ok: false, reason: compiled.reason };

  const runQuery = async (sql: string, limit?: number): Promise<any[] | null> => {
    const checked = isReadOnlySelectSql(sql);
    if (!checked.ok) return null;
    const limited = enforceSelectLimit(checked.sql, 100, limit ?? (spec!.limit || 10));
    const withHint = injectMysqlMaxExecutionTimeHint(limited, 8000);
    try {
      const rows = await params.ds.query(withHint);
      return Array.isArray(rows) && rows.length ? rows : null;
    } catch {
      return null;
    }
  };

  let rows = await runQuery(compiled.sql);
  if (!rows) {
    for (const alt of compileJsonArrayJoinAlternates(spec)) {
      rows = await runQuery(alt);
      if (rows) {
        compiled = { ok: true, sql: alt };
        break;
      }
    }
  }
  if (!rows && (plan?.filters?.slots?.length ?? 0) > 0) {
    const tables = [
      spec.anchor_table,
      ...(spec.json_array_join?.to_table ? [spec.json_array_join.to_table] : []),
      ...(params.schemaGround?.table_judge?.primary_tables ?? []),
    ];
    const metas = await expandMetasForJsonArrayJoins(
      params.ds,
      await loadTableColumnMeta(params.ds, tables),
    );
    const remapped = await mapFilterSlotsToSchemaFilters(params.model, {
      question: params.question,
      queryPlan: plan,
      anchorTable: spec.anchor_table,
      metas,
      existingFilters: [],
    });
    if (remapped?.length) {
      spec = { ...spec, filters: remapped };
      const retryCompiled = compileSchemaLinkToSql(spec);
      if (retryCompiled.ok) {
        rows = await runQuery(retryCompiled.sql);
        if (rows) compiled = retryCompiled;
        if (!rows) {
          for (const alt of compileJsonArrayJoinAlternates(spec)) {
            rows = await runQuery(alt);
            if (rows) {
              compiled = { ok: true, sql: alt };
              break;
            }
          }
        }
      }
    }
  }
  if (!rows) {
    const repaired = await repairSqlWithLlm(params.model, {
      question: params.question,
      sql: compiled.sql,
      error: "execution failed or empty",
      schemaSummary: params.schemaGround?.schema_summary,
    });
    if (repaired) {
      rows = await runQuery(repaired);
      if (rows) compiled = { ok: true, sql: repaired };
    }
  }

  if (!rows?.length) return { ok: false, reason: "empty_result" };
  if (isEnumerateRowsMode(shape, spec)) {
    rows = dedupeEnumerateRows(rows);
  }
  return {
    ok: true,
    sql: compiled.sql,
    rows,
    spec_reason: spec.reason,
    mode: spec.mode,
    result_cardinality: spec.result_cardinality,
    use_distinct: spec.use_distinct,
  };
}

/** JSON 数组关联的备选 SQL（JSON_TABLE 失败时） */
export function compileJsonArrayJoinAlternates(spec: SchemaLinkSpec): string[] {
  if (spec.mode !== "json_array_join" || !spec.json_array_join) return [];
  const j = spec.json_array_join;
  const anchorAlias = tableAlias(spec.anchor_table);
  const toAlias = tableAlias(j.to_table);
  const selectCol = spec.select[0];
  if (!selectCol) return [];
  const distinct = spec.use_distinct ? "DISTINCT " : "";
  const sel = `${quoteId(toAlias)}.${quoteId(selectCol.column)}`;
  const whereParts = spec.filters
    .map((f) => compileFilter(f, new Map([
      [spec.anchor_table, anchorAlias],
      [j.to_table, toAlias],
    ])))
    .filter(Boolean) as string[];
  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const alts: string[] = [];

  alts.push(
    [
      `SELECT ${distinct}${sel}`,
      `FROM ${quoteId(spec.anchor_table)} ${quoteId(anchorAlias)}`,
      `JOIN ${quoteId(j.to_table)} ${quoteId(toAlias)} ON JSON_CONTAINS(CAST(${quoteId(anchorAlias)}.${quoteId(j.json_column)} AS JSON), CAST(${quoteId(toAlias)}.${quoteId(j.to_column)} AS JSON), '$')`,
      where,
      `LIMIT ${spec.limit || 10}`,
    ].join(" "),
  );

  alts.push(
    [
      `SELECT ${distinct}${sel}`,
      `FROM ${quoteId(spec.anchor_table)} ${quoteId(anchorAlias)}`,
      `JOIN ${quoteId(j.to_table)} ${quoteId(toAlias)} ON FIND_IN_SET(${quoteId(toAlias)}.${quoteId(j.to_column)}, REPLACE(REPLACE(REPLACE(CAST(${quoteId(anchorAlias)}.${quoteId(j.json_column)} AS CHAR), '[', ''), ']', ''), ' ', '')) > 0`,
      where,
      `LIMIT ${spec.limit || 10}`,
    ].join(" "),
  );
  return alts;
}
