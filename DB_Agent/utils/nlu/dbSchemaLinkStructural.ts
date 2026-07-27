/**
 * Schema 结构推断（DIN-SQL Decomposer + MAC-SQL Selector 思路）。
 * 仅使用 QueryPlan 槽位 + information_schema 元数据，不读问句、不用业务正则。
 */
import type { QueryPlan } from "./query_plan";
import type { SchemaGroundResult } from "../schema_ground";
import type { SchemaLinkFilter, SchemaLinkSelect, SchemaLinkSpec, TableColumnMeta } from "./dbSchemaLinkLlm";
import { mapFilterSlotsStructural, rankAnchorTablesByPlanSlots, scoreColumnForFieldHint } from "./dbFilterSlotMapLlm";
import type { QueryExecutionShape } from "./dbQueryExecutionShapeLlm";
import { planMetricsLookLikeDetailEnumerate } from "./dbQueryExecutionShapeLlm";
import { isEnumerateRowsMode } from "./dbSchemaLinkResultMode";
import { scoreColumnAgainstMetrics, columnLooksNumeric } from "./dbSchemaLinkColumnScore";
import { inferSingleTableDetailRecordSpec } from "./dbSchemaLinkDetailRecord";

function columnLooksLikeJsonIdArray(col: { name: string; comment: string; data_type: string }): boolean {
  const dt = String(col.data_type ?? "").toLowerCase();
  if (dt.includes("json")) return true;
  const name = String(col.name ?? "").toLowerCase();
  const comment = String(col.comment ?? "").trim();
  if (name.startsWith("arr_") && name.includes("_id")) return true;
  if (/列表|数组/.test(comment) && /id/i.test(comment)) return true;
  if (/绑定/.test(comment) && /id|列表/.test(comment)) return true;
  return false;
}

export { columnLooksLikeJsonIdArray };

function columnNameLooksLikeId(name: string): boolean {
  const k = String(name ?? "").toLowerCase();
  return k === "id" || k.endsWith("_id");
}

function jsonColumnStem(name: string): string {
  let s = String(name ?? "").trim();
  if (s.startsWith("arr_")) s = s.slice(4);
  if (s.endsWith("_id")) s = s.slice(0, -3);
  return s;
}

function resolveJsonArrayTargetTable(
  anchorTable: string,
  jc: { name: string },
  metas: TableColumnMeta[],
  rels: SchemaGroundResult["relations"],
  metrics: string[] = [],
): string {
  let targetTable =
    rels?.find((r) => r.from_table === anchorTable && r.from_column === jc.name)?.to_table ?? "";
  if (!targetTable) {
    const stem = jsonColumnStem(jc.name);
    if (stem) {
      targetTable = rankJsonTargetTables(stem, metas, anchorTable, metrics)[0]?.table ?? "";
    }
  }
  if (!targetTable) {
    targetTable = rels?.find((r) => r.from_table === anchorTable)?.to_table ?? "";
  }
  return targetTable;
}

function pickBestSelectColumn(
  targetMeta: TableColumnMeta,
  metrics: string[],
  enumerate = false,
): { name: string; score: number } | null {
  const skipNames = new Set(["deleted", "is_deleted", "del_flag", "status", "is_yn_open"]);
  const selectCandidates = targetMeta.columns.filter(
    (c) => !columnNameLooksLikeId(c.name) && !skipNames.has(c.name.toLowerCase()),
  );
  const ranked = selectCandidates
    .map((c) => ({ c, score: scoreColumnAgainstMetrics(c, metrics, targetMeta.table_comment) }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0]?.score) return { name: ranked[0].c.name, score: ranked[0].score };
  const nameCol = selectCandidates.find((c) => c.name.toLowerCase().includes("name"));
  if (nameCol) return { name: nameCol.name, score: 3 };
  if (enumerate) {
    const textCol = selectCandidates.find(
      (c) =>
        c.name.toLowerCase().endsWith("_content") ||
        c.name.toLowerCase().includes("content") ||
        (!columnLooksNumeric(c.data_type) && c.name.length > 4),
    );
    if (textCol) return { name: textCol.name, score: 4 };
  }
  return null;
}

function planEnumerateRows(
  executionShape?: QueryExecutionShape | null,
  plan?: QueryPlan | null,
): boolean {
  return isEnumerateRowsMode(executionShape, { result_cardinality: plan?.intent === "detail" ? "enumerate_rows" : undefined });
}

function pickChildOrderColumn(childMeta: TableColumnMeta): string | null {
  const ranked = childMeta.columns
    .filter((c) => !columnNameLooksLikeId(c.name) && c.name !== "deleted")
    .map((c) => {
      const name = c.name.toLowerCase();
      const comment = String(c.comment ?? "");
      let score = 0;
      if (name.includes("option_type") || name.includes("option_index")) score += 20;
      if (comment.includes("选项") && (comment.includes("编号") || comment.includes("类型"))) score += 16;
      if (name.endsWith("_type") && name.includes("option")) score += 12;
      if (name === "sort" || comment.includes("序号")) score += 10;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score ? ranked[0].c.name : null;
}

function rankJsonTargetTables(
  stem: string,
  metas: TableColumnMeta[],
  anchorTable: string,
  metrics: string[],
  enumerate = false,
): TableColumnMeta[] {
  return metas
    .filter((m) => m.table !== anchorTable && m.table.includes(stem))
    .map((m) => {
      let score = 0;
      if (m.table.endsWith(`${stem}_info`)) score += 40;
      else if (m.table.includes(`${stem}_info`)) score += 25;
      if (m.table.endsWith("_option") || m.table.endsWith("_detail")) {
        score += enumerate ? 35 : -20;
      }
      for (const metric of metrics) {
        const t = String(metric).toLowerCase();
        const blob = `${m.table} ${m.table_comment}`.toLowerCase();
        if (t.length >= 2 && blob.includes(t.slice(0, Math.min(4, t.length)))) score += 8;
      }
      return { m, score };
    })
    .sort((a, b) => b.score - a.score || a.m.table.length - b.m.table.length)
    .map((x) => x.m);
}

type FkRelation = {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
};

function extractFkRelationsFromMetas(metas: TableColumnMeta[]): FkRelation[] {
  const rels: FkRelation[] = [];
  for (const detail of metas) {
    for (const col of detail.columns) {
      const cn = col.name.toLowerCase();
      if (!cn.endsWith("_id") || cn === "id") continue;
      const stem = cn.slice(0, -3);
      if (!stem) continue;
      const parent =
        metas.find((m) => m.table.toLowerCase() === `${stem}_info`) ||
        metas.find((m) => m.table.toLowerCase() === stem) ||
        metas.find((m) => m.table.toLowerCase().endsWith(`_${stem}`)) ||
        metas.find((m) => m.table.toLowerCase().includes(stem) && m.table !== detail.table);
      if (!parent || parent.table === detail.table) continue;
      const toCol = parent.columns.find((c) => c.name.toLowerCase() === "id")?.name ?? "id";
      const dup = rels.some(
        (r) => r.from_table === detail.table && r.from_column === col.name && r.to_table === parent.table,
      );
      if (!dup) {
        rels.push({
          from_table: detail.table,
          from_column: col.name,
          to_table: parent.table,
          to_column: toCol,
        });
      }
    }
  }
  return rels;
}

function collectFkRelations(metas: TableColumnMeta[], schemaGround?: SchemaGroundResult | null): FkRelation[] {
  const fromGround = (schemaGround?.relations ?? []).map((r) => ({
    from_table: r.from_table,
    from_column: r.from_column,
    to_table: r.to_table,
    to_column: r.to_column,
  }));
  const fromMeta = extractFkRelationsFromMetas(metas);
  const seen = new Set<string>();
  const out: FkRelation[] = [];
  for (const r of [...fromGround, ...fromMeta]) {
    const key = `${r.from_table}.${r.from_column}->${r.to_table}.${r.to_column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function buildFkJoinSpec(
  rel: FkRelation,
  metas: TableColumnMeta[],
  plan: QueryPlan,
  filters: SchemaLinkFilter[],
  executionShape?: QueryExecutionShape | null,
): SchemaLinkSpec | null {
  const parentMeta = metas.find((m) => m.table === rel.to_table);
  const childMeta = metas.find((m) => m.table === rel.from_table);
  if (!parentMeta || !childMeta) return null;

  const enumerate = planEnumerateRows(executionShape, plan);
  const bestSelect = pickBestSelectColumn(childMeta, plan.metrics ?? [], enumerate);
  if (!bestSelect || (bestSelect.score < 4 && !enumerate)) return null;

  const parentFilters = filters.filter((f) => f.table === parentMeta.table);
  const effectiveFilters = parentFilters.length ? parentFilters : filters;
  const select: SchemaLinkSelect[] = [{ table: childMeta.table, column: bestSelect.name }];
  const orderCol = enumerate ? pickChildOrderColumn(childMeta) : null;

  return {
    mode: "fk_join",
    anchor_table: parentMeta.table,
    filters: effectiveFilters,
    select,
    fk_joins: [
      {
        from_table: parentMeta.table,
        from_column: rel.to_column,
        to_table: childMeta.table,
        to_column: rel.from_column,
      },
    ],
    use_distinct: false,
    limit: enumerate ? 30 : Math.max(1, Math.min(20, plan.limit || 10)),
    confidence: 0.7,
    reason: "schema_fk_join_infer",
    result_cardinality: enumerate ? "enumerate_rows" : undefined,
    order_by: orderCol ? [{ table: childMeta.table, column: orderCol }] : undefined,
  };
}

function inferFkJoinFromSchemaAndPlan(
  metas: TableColumnMeta[],
  plan: QueryPlan,
  schemaGround?: SchemaGroundResult | null,
  filters: SchemaLinkFilter[] = [],
  executionShape?: QueryExecutionShape | null,
): SchemaLinkSpec | null {
  const metrics = plan.metrics ?? [];
  const enumerate = planEnumerateRows(executionShape, plan);
  if (!metrics.length && !enumerate) return null;
  if (!enumerate) {
    const childScores = metas.flatMap((m) =>
      m.columns.map((c) => scoreColumnAgainstMetrics(c, metrics, m.table_comment)),
    );
    if (!childScores.some((s) => s >= 6)) return null;
  }

  const rels = collectFkRelations(metas, schemaGround);
  let best: { spec: SchemaLinkSpec; score: number } | null = null;

  for (const rel of rels) {
    const parentMeta = metas.find((m) => m.table === rel.to_table);
    if (!parentMeta) continue;
    const anchorFilters = mapFilterSlotsStructural(plan, metas, parentMeta.table);
    const mergedFilters = anchorFilters.length ? anchorFilters : filters;
    const spec = buildFkJoinSpec(rel, metas, plan, mergedFilters, executionShape);
    if (!spec) continue;
    const score = scoreSchemaLinkSpec(spec, plan, metas, mergedFilters);
    if (!best || score > best.score) best = { spec, score };
  }

  return best && best.score >= 12 ? best.spec : null;
}

export function scoreSchemaLinkSpec(
  spec: SchemaLinkSpec,
  plan: QueryPlan,
  metas: TableColumnMeta[],
  filters: SchemaLinkFilter[],
): number {
  let score = 0;
  const metrics = plan.metrics ?? [];
  const slots = plan.filters?.slots ?? [];
  const selectCol = spec.select[0];
  if (!selectCol) return 0;

  const anchorMeta = metas.find((m) => m.table === spec.anchor_table);
  const selectMeta = metas.find((m) => m.table === selectCol.table);

  for (const f of filters) {
    if (f.table === spec.anchor_table) score += 18;
    else score += 6;
  }
  if (slots.length && filters.length >= slots.length) score += 12;

  const selectColumn = selectMeta?.columns.find((c) => c.name === selectCol.column);
  if (selectColumn) {
    score += scoreColumnAgainstMetrics(selectColumn, metrics, selectMeta?.table_comment ?? "") * 5;
  }

  if (spec.mode === "json_array_join") {
    if (selectCol.table !== spec.anchor_table) score += 45;
    else score -= 50;
    if (anchorMeta) {
      const bestNumeric = anchorMeta.columns
        .filter((c) => columnLooksNumeric(c.data_type) && !columnLooksLikeJsonIdArray(c))
        .map((c) => scoreColumnAgainstMetrics(c, metrics, anchorMeta.table_comment))
        .sort((a, b) => b - a)[0] ?? 0;
      if (bestNumeric >= 10) score -= 50;
    }
    const targetTable = spec.json_array_join?.to_table ?? "";
    const targetMeta = metas.find((m) => m.table === targetTable);
    if (targetMeta) {
      for (const m of metrics) {
        const blob = `${targetMeta.table} ${targetMeta.table_comment}`.toLowerCase();
        const t = String(m).toLowerCase();
        if (t.length >= 2 && blob.includes(t.slice(0, Math.min(4, t.length)))) score += 8;
      }
    }
  }

  if (spec.mode === "fk_join") {
    if (selectCol.table !== spec.anchor_table) score += 50;
    else score -= 40;
    const enumerate = spec.result_cardinality === "enumerate_rows" || plan.intent === "detail";
    if (enumerate) score += 20;
    if (selectColumn && columnLooksNumeric(selectColumn.data_type) && enumerate) score -= 25;
  }

  if (spec.mode === "single_table") {
    if (selectCol.table === spec.anchor_table) score += 25;
    if (selectColumn && columnLooksNumeric(selectColumn.data_type)) score += 10;
    if (selectColumn && columnLooksLikeJsonIdArray(selectColumn)) score -= 40;
    if ((spec.result_cardinality === "enumerate_rows" || plan.intent === "detail") && selectCol.table === spec.anchor_table) {
      score -= 30;
    }
  }

  if (anchorMeta && slots.length) {
    for (const slot of slots) {
      const best = anchorMeta.columns
        .map((c) => scoreColumnForFieldHint(c, slot.field_hint, anchorMeta.table_comment))
        .sort((a, b) => b - a)[0];
      if (best && best > 0) score += Math.min(best, 15);
    }
  }

  return score;
}

function buildJsonArrayJoinSpec(
  anchorTable: string,
  jc: { name: string },
  metas: TableColumnMeta[],
  plan: QueryPlan,
  schemaGround: SchemaGroundResult | null | undefined,
  filters: SchemaLinkFilter[],
): SchemaLinkSpec | null {
  const rels = schemaGround?.relations ?? [];
  const targetTable = resolveJsonArrayTargetTable(anchorTable, jc, metas, rels, plan.metrics ?? []);
  const targetMeta = metas.find((m) => m.table === targetTable);
  if (!targetMeta) return null;

  const toColumn =
    targetMeta.columns.find((c) => c.name === "id")?.name ??
    targetMeta.columns.find((c) => columnNameLooksLikeId(c.name))?.name ??
    "id";

  const bestSelect = pickBestSelectColumn(targetMeta, plan.metrics ?? []);
  if (!bestSelect) return null;

  const select: SchemaLinkSelect[] = [{ table: targetTable, column: bestSelect.name }];
  return {
    mode: "json_array_join",
    anchor_table: anchorTable,
    filters,
    select,
    json_array_join: {
      from_table: anchorTable,
      json_column: jc.name,
      to_table: targetTable,
      to_column: toColumn,
      select,
    },
    result_cardinality: "distinct_set",
    use_distinct: true,
    limit: Math.max(1, Math.min(20, plan.limit || 10)),
    confidence: 0.68,
    reason: "schema_json_array_infer",
  };
}

export function inferJsonArrayJoinFromSchemaAndPlan(
  metas: TableColumnMeta[],
  plan: QueryPlan,
  schemaGround?: SchemaGroundResult | null,
  filters: SchemaLinkFilter[] = [],
): SchemaLinkSpec | null {
  const metrics = plan.metrics ?? [];
  if (!metrics.length) return null;
  // 明细枚举走子表多列，禁止被 JSON 数组名称关联抢走
  if (planMetricsLookLikeDetailEnumerate(plan)) return null;

  const preferred = [
    schemaGround?.table_judge?.primary_tables?.[0] ?? "",
    ...(schemaGround?.candidate_tables ?? []),
  ].filter(Boolean);
  const anchorOrder = rankAnchorTablesByPlanSlots(plan, metas, preferred);
  const anchors = (anchorOrder.length ? anchorOrder : metas.map((m) => m.table)).slice(0, 8);

  let best: { spec: SchemaLinkSpec; score: number } | null = null;
  for (const anchorTable of anchors) {
    const anchorMeta = metas.find((m) => m.table === anchorTable);
    if (!anchorMeta) continue;
    const jsonCols = anchorMeta.columns.filter((c) => columnLooksLikeJsonIdArray(c));
    for (const jc of jsonCols) {
      const spec = buildJsonArrayJoinSpec(anchorTable, jc, metas, plan, schemaGround, filters);
      if (!spec) continue;
      const score = scoreSchemaLinkSpec(spec, plan, metas, filters);
      if (!best || score > best.score) best = { spec, score };
    }
  }
  return best && best.score >= 8 ? best.spec : null;
}

export function inferSingleTableScalarFromSchemaAndPlan(
  metas: TableColumnMeta[],
  plan: QueryPlan,
  filters: SchemaLinkFilter[],
  anchorTable: string,
): SchemaLinkSpec | null {
  const metrics = plan.metrics ?? [];
  if (!metrics.length) return null;
  const anchorMeta = metas.find((m) => m.table === anchorTable);
  if (!anchorMeta) return null;

  const ranked = anchorMeta.columns
    .filter((c) => !columnNameLooksLikeId(c.name) && !columnLooksLikeJsonIdArray(c))
    .map((c) => ({
      c,
      score: scoreColumnAgainstMetrics(c, metrics, anchorMeta.table_comment),
    }))
    .sort((a, b) => b.score - a.score);

  if (!ranked[0]?.score || ranked[0].score < 4) return null;

  return {
    mode: "single_table",
    anchor_table: anchorTable,
    filters,
    select: [{ table: anchorTable, column: ranked[0].c.name }],
    use_distinct: false,
    limit: Math.max(1, Math.min(5, plan.limit || 3)),
    confidence: 0.72,
    reason: "schema_single_scalar_infer",
  };
}

/** 结构推断：按锚点排序，尝试 JSON 数组关联与单表标量，返回最高分 spec */
export function resolveStructuralScalarSpec(
  metas: TableColumnMeta[],
  plan: QueryPlan,
  schemaGround?: SchemaGroundResult | null,
  executionShape?: QueryExecutionShape | null,
): SchemaLinkSpec | null {
  const metrics = plan.metrics ?? [];
  const enumerate = planEnumerateRows(executionShape, plan);
  if (!metrics.length && !enumerate) return null;

  const preferred = [
    schemaGround?.table_judge?.primary_tables?.[0] ?? "",
    ...(schemaGround?.candidate_tables ?? []),
  ].filter(Boolean);
  const anchors = rankAnchorTablesByPlanSlots(plan, metas, preferred);
  const anchorOrder = (anchors.length ? anchors : metas.map((m) => m.table)).slice(0, 8);

  let best: { spec: SchemaLinkSpec; score: number } | null = null;

  for (const anchorTable of anchorOrder) {
    const filters = mapFilterSlotsStructural(plan, metas, anchorTable);

    const fkSpec = inferFkJoinFromSchemaAndPlan(metas, plan, schemaGround, filters, executionShape);
    if (fkSpec) {
      const score = scoreSchemaLinkSpec(fkSpec, plan, metas, fkSpec.filters);
      if (!best || score > best.score) best = { spec: fkSpec, score };
    }

    const jsonSpec = inferJsonArrayJoinFromSchemaAndPlan(metas, plan, schemaGround, filters);
    if (jsonSpec) {
      const score = scoreSchemaLinkSpec(jsonSpec, plan, metas, filters);
      if (!best || score > best.score) best = { spec: jsonSpec, score };
    }

    if (enumerate && filters.length) {
      const detailSpec = inferSingleTableDetailRecordSpec(metas, plan, filters, anchorTable);
      if (detailSpec) {
        const score = scoreSchemaLinkSpec(detailSpec, plan, metas, filters) + 20;
        if (!best || score > best.score) best = { spec: detailSpec, score };
      }
    } else {
      const scalarSpec = inferSingleTableScalarFromSchemaAndPlan(metas, plan, filters, anchorTable);
      if (scalarSpec) {
        const score = scoreSchemaLinkSpec(scalarSpec, plan, metas, filters);
        if (!best || score > best.score) best = { spec: scalarSpec, score };
      }
    }
  }

  return best && best.score >= 8 ? best.spec : null;
}
