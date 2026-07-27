/**
 * Schema Linking（DIN-SQL / MAC-SQL 风格）：纯 LLM + schema 元数据 + QueryPlan 槽位。
 * 不使用问句/槽位正则、不使用业务词表结构性 fallback。
 */
import { z } from "zod";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { DataSource } from "typeorm";
import type { QueryPlan } from "./query_plan";
import type { SchemaGroundResult } from "../schema_ground";
import { clipText } from "./text";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";
import type { QueryExecutionShape } from "./dbQueryExecutionShapeLlm";
import { mergeResultModeIntoSpec, type ResultCardinality } from "./dbSchemaLinkResultMode";
import { expandSpecForDetailRecord } from "./dbSchemaLinkDetailRecord";
import { shouldBypassFastPathsForQuestion } from "../query_learning";
import {
  mapFilterSlotsToSchemaFilters,
  mergeSchemaLinkFilters,
  specCoversFilterSlots,
} from "./dbFilterSlotMapLlm";
import {
  columnLooksLikeJsonIdArray,
  inferJsonArrayJoinFromSchemaAndPlan,
  resolveStructuralScalarSpec,
  scoreSchemaLinkSpec,
} from "./dbSchemaLinkStructural";

export { columnLooksLikeJsonIdArray };

export type TableColumnMeta = {
  table: string;
  table_comment: string;
  columns: { name: string; comment: string; data_type: string }[];
};

export type SchemaLinkFilter = {
  table: string;
  column: string;
  op: "=" | "!=" | "like" | ">" | "<" | ">=" | "<=" | "in";
  value: string;
};

export type SchemaLinkSelect = {
  table: string;
  column: string;
  alias?: string;
};

export type JsonArrayJoinLink = {
  from_table: string;
  json_column: string;
  to_table: string;
  to_column: string;
  select: SchemaLinkSelect[];
};

export type SchemaLinkSpec = {
  mode: "single_table" | "json_array_join" | "fk_join";
  anchor_table: string;
  filters: SchemaLinkFilter[];
  select: SchemaLinkSelect[];
  json_array_join?: JsonArrayJoinLink;
  fk_joins?: { from_table: string; from_column: string; to_table: string; to_column: string }[];
  use_distinct: boolean;
  limit: number;
  confidence: number;
  reason?: string;
  order_by?: SchemaLinkSelect[];
  result_cardinality?: ResultCardinality;
};

const LinkSchema = z.object({
  mode: z.enum(["single_table", "json_array_join", "fk_join"]),
  anchor_table: z.string(),
  filters: z
    .array(
      z.object({
        table: z.string(),
        column: z.string(),
        op: z.enum(["=", "!=", "like", ">", "<", ">=", "<=", "in"]).default("="),
        value: z.string(),
      }),
    )
    .max(8)
    .default([]),
  select: z
    .array(
      z.object({
        table: z.string(),
        column: z.string(),
        alias: z.string().optional(),
      }),
    )
    .min(1)
    .max(12),
  json_array_join: z
    .object({
      from_table: z.string(),
      json_column: z.string(),
      to_table: z.string(),
      to_column: z.string(),
    })
    .optional(),
  fk_joins: z
    .array(
      z.object({
        from_table: z.string(),
        from_column: z.string(),
        to_table: z.string(),
        to_column: z.string(),
      }),
    )
    .max(4)
    .optional(),
  use_distinct: z.boolean().optional(),
  limit: z.number().int().min(1).max(30).optional(),
  result_cardinality: z.enum(["single", "distinct_set", "enumerate_rows"]).optional(),
  order_by: z
    .array(
      z.object({
        table: z.string(),
        column: z.string(),
      }),
    )
    .max(2)
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
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

export function isDbSchemaLinkLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("schema_link");
}

export async function loadTableColumnMeta(ds: DataSource, tables: string[]): Promise<TableColumnMeta[]> {
  const out: TableColumnMeta[] = [];
  for (const table of Array.from(new Set(tables.filter(Boolean))).slice(0, 10)) {
    try {
      const [trows] = await ds.query(
        `SELECT COALESCE(table_comment,'') AS comment FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
        [table],
      );
      const table_comment = String((trows as any[])?.[0]?.comment ?? "");
      const cols = await ds.query(
        `SELECT column_name AS name, COALESCE(column_comment,'') AS comment, LOWER(data_type) AS data_type
         FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?
         ORDER BY ordinal_position`,
        [table],
      );
      out.push({
        table,
        table_comment,
        columns: Array.isArray(cols)
          ? (cols as any[])
              .map((c) => ({
                name: String(c?.name ?? "").trim(),
                comment: String(c?.comment ?? "").trim(),
                data_type: String(c?.data_type ?? "").trim(),
              }))
              .filter((c) => c.name)
          : [],
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

/** 依据 anchor 表上的 JSON/ID 数组列名 stem，补全关联目标表 meta（避免 maxTables 截断漏表） */
export async function expandMetasForJsonArrayJoins(
  ds: DataSource,
  metas: TableColumnMeta[],
): Promise<TableColumnMeta[]> {
  const known = new Set(metas.map((m) => m.table));
  const extraNames: string[] = [];
  for (const m of metas) {
    for (const c of m.columns) {
      if (!columnLooksLikeJsonIdArray(c)) continue;
      const stem = jsonColumnStem(c.name);
      if (stem.length < 3) continue;
      try {
        const rows = (await ds.query(
          `SELECT table_name AS name FROM information_schema.tables
           WHERE table_schema = DATABASE() AND table_name LIKE ? AND table_name <> ?
           ORDER BY table_name LIMIT 8`,
          [`%${stem}%`, m.table],
        )) as { name?: string }[];
        for (const r of rows) {
          const name = String(r?.name ?? "").trim();
          if (name && !known.has(name)) {
            known.add(name);
            extraNames.push(name);
          }
        }
      } catch {
        /* skip */
      }
    }
  }
  if (!extraNames.length) return metas;
  const extra = await loadTableColumnMeta(ds, extraNames);
  return [...metas, ...extra];
}

/** 用 schema 接地候选表 + 已发现外键关系扩展 Join 表集合（无问句正则） */
function expandTablesViaSchemaGround(tables: string[], schemaGround?: SchemaGroundResult | null): string[] {
  const relTables = (schemaGround?.relations ?? []).flatMap((r) => [r.from_table, r.to_table]);
  return Array.from(new Set([...tables, ...relTables].filter(Boolean))).slice(0, 10);
}

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

function isSchemaLinkStructuralFirstEnabled(): boolean {
  return String(process.env.DB_SCHEMA_LINK_STRUCTURAL_FIRST ?? "1").trim() !== "0";
}

function formatMetaBlock(metas: TableColumnMeta[]): string {
  const lines: string[] = [];
  for (const m of metas) {
    lines.push(`表 ${m.table}${m.table_comment ? ` // ${m.table_comment}` : ""}`);
    for (const c of m.columns.slice(0, 40)) {
      lines.push(`  - ${c.name}${c.comment ? ` // ${c.comment}` : ""} (${c.data_type})`);
    }
  }
  return clipText(lines.join("\n"), 3500);
}

function formatFilterSlotsBlock(plan?: QueryPlan | null): string {
  const slots = plan?.filters?.slots ?? [];
  if (!slots.length) return "";
  return slots
    .map((s) => `- ${s.field_hint}：用户值=${s.value}；建议 SQL 匹配值=${s.sql_match_value || s.value}`)
    .join("\n");
}

function validateSpec(spec: SchemaLinkSpec, metas: TableColumnMeta[]): SchemaLinkSpec | null {
  const tableSet = new Set(metas.map((m) => m.table));
  const colSet = new Map<string, Set<string>>();
  for (const m of metas) colSet.set(m.table, new Set(m.columns.map((c) => c.name)));

  if (!tableSet.has(spec.anchor_table)) return null;
  for (const f of spec.filters) {
    if (!colSet.get(f.table)?.has(f.column)) return null;
  }
  for (const s of spec.select) {
    if (!colSet.get(s.table)?.has(s.column)) return null;
  }
  if (spec.json_array_join) {
    const j = spec.json_array_join;
    if (!colSet.get(j.from_table)?.has(j.json_column)) return null;
    if (!colSet.get(j.to_table)?.has(j.to_column)) return null;
  }
  return spec;
}

function parseToSpec(raw: z.infer<typeof LinkSchema>, metas: TableColumnMeta[]): SchemaLinkSpec | null {
  const select = raw.select.map((s) => ({
    table: String(s.table).trim(),
    column: String(s.column).trim(),
    alias: s.alias ? String(s.alias).trim() : undefined,
  }));
  const spec: SchemaLinkSpec = {
    mode: raw.mode,
    anchor_table: String(raw.anchor_table).trim(),
    filters: (raw.filters ?? []).map((f) => ({
      table: String(f.table).trim(),
      column: String(f.column).trim(),
      op: f.op,
      value: String(f.value ?? "").trim(),
    })),
    select,
    use_distinct: raw.use_distinct ?? raw.mode !== "single_table",
    limit: raw.limit ?? 10,
    confidence: raw.confidence ?? 0.7,
    reason: raw.reason,
  };
  if (raw.json_array_join) {
    spec.json_array_join = {
      from_table: String(raw.json_array_join.from_table).trim(),
      json_column: String(raw.json_array_join.json_column).trim(),
      to_table: String(raw.json_array_join.to_table).trim(),
      to_column: String(raw.json_array_join.to_column).trim(),
      select,
    };
  }
  if (raw.fk_joins?.length) {
    spec.fk_joins = raw.fk_joins.map((j) => ({
      from_table: String(j.from_table).trim(),
      from_column: String(j.from_column).trim(),
      to_table: String(j.to_table).trim(),
      to_column: String(j.to_column).trim(),
    }));
  }
  if (raw.order_by?.length) {
    spec.order_by = raw.order_by.map((o) => ({
      table: String(o.table).trim(),
      column: String(o.column).trim(),
    }));
  }
  if (raw.result_cardinality) {
    spec.result_cardinality = raw.result_cardinality;
  }
  return validateSpec(spec, metas);
}

function formatJsonColumnHints(metas: TableColumnMeta[]): string {
  const lines: string[] = [];
  for (const m of metas) {
    for (const c of m.columns) {
      if (!columnLooksLikeJsonIdArray(c)) continue;
      lines.push(`- ${m.table}.${c.name} (${c.data_type})${c.comment ? ` // ${c.comment}` : ""}`);
    }
  }
  if (!lines.length) return "";
  return `JSON/ID 数组列（varchar 存 JSON 数组时也用 json_array_join + CAST AS JSON）：\n${lines.join("\n")}`;
}

function structuralLinkMinScore(): number {
  const n = Number(process.env.DB_SCHEMA_LINK_STRUCTURAL_MIN_SCORE ?? 42);
  return Number.isFinite(n) && n > 0 ? n : 42;
}

function shouldShortCircuitStructuralLink(
  spec: SchemaLinkSpec,
  plan: QueryPlan,
  metas: TableColumnMeta[],
  slots: QueryPlan["filters"]["slots"],
): boolean {
  const score = scoreSchemaLinkSpec(spec, plan, metas, spec.filters);
  if (score < structuralLinkMinScore()) return false;
  if (slots.length && !specCoversFilterSlots(spec.filters, slots)) return false;
  return true;
}

async function tryStructuralSchemaLink(
  model: BaseLanguageModel | null,
  metas: TableColumnMeta[],
  plan: QueryPlan,
  schemaGround?: SchemaGroundResult | null,
  executionShape?: QueryExecutionShape | null,
): Promise<SchemaLinkSpec | null> {
  const slots = plan.filters?.slots ?? [];
  const enumerate = executionShape === "detail_rows" || plan.intent === "detail";
  if (!plan.metrics?.length && !enumerate) return null;
  let spec = resolveStructuralScalarSpec(metas, plan, schemaGround, executionShape);
  if (!spec) return null;

  if (slots.length && !specCoversFilterSlots(spec.filters, slots) && model) {
    const mapped = await mapFilterSlotsToSchemaFilters(model, {
      question: "",
      queryPlan: plan,
      anchorTable: spec.anchor_table,
      metas,
      existingFilters: spec.filters,
    });
    if (mapped?.length) {
      spec = { ...spec, filters: mergeSchemaLinkFilters(spec.filters, mapped) };
    }
  }
  if (slots.length && !specCoversFilterSlots(spec.filters, slots)) return null;
  return validateSpec(spec, metas);
}

export async function linkSchemaForScalarQuery(
  model: BaseLanguageModel | null,
  ds: DataSource,
  opts: {
    question: string;
    queryPlan?: QueryPlan | null;
    schemaGround?: SchemaGroundResult | null;
    executionShape?: QueryExecutionShape | null;
  },
): Promise<SchemaLinkSpec | null> {
  const q = String(opts.question ?? "").trim();
  if (!q) return null;

  const tables = [
    ...(opts.schemaGround?.table_judge?.primary_tables ?? []),
    ...(opts.schemaGround?.candidate_tables ?? []),
  ];
  const uniq = expandTablesViaSchemaGround(tables, opts.schemaGround);
  if (!uniq.length) return null;

  let metas = await loadTableColumnMeta(ds, uniq);
  metas = await expandMetasForJsonArrayJoins(ds, metas);
  if (!metas.length) return null;

  const plan = opts.queryPlan;
  const slots = plan?.filters?.slots ?? [];
  const primary = opts.schemaGround?.table_judge?.primary_tables?.[0] ?? "";
  const metrics = (plan?.metrics ?? []).join("、");
  const filters = (plan?.filters?.where ?? []).join("；");
  const slotBlock = formatFilterSlotsBlock(plan);

  try {
    if (
      !shouldBypassFastPathsForQuestion(q) &&
      isSchemaLinkStructuralFirstEnabled() &&
      plan
    ) {
      const structural = await tryStructuralSchemaLink(model, metas, plan, opts.schemaGround, opts.executionShape);
      if (structural && shouldShortCircuitStructuralLink(structural, plan, metas, slots)) {
        return mergeResultModeIntoSpec(
          expandSpecForDetailRecord(structural, metas, plan, opts.executionShape),
          {
            executionShape: opts.executionShape,
            resultCardinality: structural.result_cardinality,
            planLimit: plan?.limit,
          },
        );
      }
    }

    if (!isDbSchemaLinkLlmEnabled() || !model) return null;

    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是 NL2SQL Schema Linking 专家。将用户问题 + QueryPlan 映射到具体表/列/Join。只输出 JSON。",
          "按语义与 schema 注释理解，勿用关键词表或正则硬匹配。",
          "规则：",
          "1) table/column 必须来自下方 schema。",
          "2) select：scalar/single 取 1~3 列；execution_shape=detail_rows 且单表按人/对象筛明细时取 3~10 个业务列（时间/数值/结果/内容等），勿只选姓名。",
          "3) filters：落实 filter_slots / filters.where；优先使用 filter_slots 中的 sql_match_value 作为 LIKE/= 的值。",
          "4) 当 filter_slots 非空时，filters 必须至少包含每条 slot 对应的 WHERE 条件，不可省略锚点筛选。",
          "5) 若库中名称字段可能存更短核心词，结合 schema 注释与用户原话自行推断 LIKE 值（勿照搬过长修饰语）。",
          "6) JSON 数组列存关联 ID 时用 mode=json_array_join，并填 json_array_join；目标属性列在关联表上，勿选锚点表上的冗余/展示字段。",
          "7) result_cardinality（模型判定，勿用问句关键词表）：",
          "   - single：单个标量/属性值（是多少、叫什么）",
          "   - distinct_set：去重属性列表，不要逐行明细（有哪些名称）",
          "   - enumerate_rows：父记录筛选后枚举全部子表明细行（分别是什么、逐项列出）；此时 use_distinct=false，limit 15~30",
          "8) 父表存主体、子表存明细时用 mode=fk_join：anchor 父表、filters 在父表、select 在子表业务列。",
          "9) field_hint 为名称类时 filter 用 *_name 列，勿用 *_type 类型列；结合列样例值判断。",
          "10) execution_shape=detail_rows：单表按姓名/对象筛「记录/明细」→ single_table + enumerate_rows + 多列；父-子枚举 → fk_join + 子表内容列。",
          'schema: {"mode":"single_table|json_array_join|fk_join","anchor_table":"","filters":[...],"select":[...],"result_cardinality":"single|distinct_set|enumerate_rows","use_distinct":true,"limit":10,"order_by":[{"table":"","column":""}],"confidence":0-1}',
        ].join("\n"),
      ],
      [
        "human",
        clipText(
          [
            `问题：${q}`,
            metrics ? `metrics：${metrics}` : "",
            filters ? `filters.where：${filters}` : "",
            slotBlock ? `filter_slots：\n${slotBlock}` : "",
            plan?.entities?.names?.length ? `entities.names：${plan.entities.names.join("、")}` : "",
            `execution_shape=${opts.executionShape ?? "scalar_lookup"}`,
            "",
            "Schema：",
            formatMetaBlock(metas),
            formatJsonColumnHints(metas),
            schemaGroundRelationsHint(opts.schemaGround),
          ]
            .filter(Boolean)
            .join("\n"),
          4200,
        ),
      ],
    ]);
    const text = typeof (res as any)?.content === "string" ? (res as any).content : JSON.stringify((res as any)?.content);
    const parsed = LinkSchema.safeParse(safeJsonParse(text));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < (slotBlock ? 0.45 : 0.52)) {
      const structural = plan ? resolveStructuralScalarSpec(metas, plan, opts.schemaGround, opts.executionShape) : null;
      if (structural) return validateSpec(structural, metas);
      let mappedFilters: SchemaLinkFilter[] = [];
      if (slots.length) {
        const mapped = await mapFilterSlotsToSchemaFilters(model, {
          question: q,
          queryPlan: plan,
          anchorTable: primary ?? metas[0]?.table ?? "",
          metas,
        });
        if (mapped?.length) mappedFilters = mapped;
      }
      const inferred = plan
        ? inferJsonArrayJoinFromSchemaAndPlan(metas, plan, opts.schemaGround, mappedFilters)
        : null;
      return inferred ? validateSpec(inferred, metas) : null;
    }
    let spec = parseToSpec(parsed.data, metas);
    if (!spec && plan) {
      let mappedFilters: SchemaLinkFilter[] = [];
      if (slots.length) {
        const mapped = await mapFilterSlotsToSchemaFilters(model, {
          question: q,
          queryPlan: plan,
          anchorTable: metas[0]?.table ?? "",
          metas,
        });
        if (mapped?.length) mappedFilters = mapped;
      }
      spec = inferJsonArrayJoinFromSchemaAndPlan(metas, plan, opts.schemaGround, mappedFilters);
      if (spec) spec = validateSpec(spec, metas);
    }
    if (!spec) return null;
    const activeSpec = spec;

    if (plan?.metrics?.length) {
      let mappedFilters = activeSpec.filters;
      if (slots.length) {
        const mapped = await mapFilterSlotsToSchemaFilters(model, {
          question: q,
          queryPlan: plan,
          anchorTable: activeSpec.anchor_table,
          metas,
          existingFilters: activeSpec.filters,
        });
        if (mapped?.length) mappedFilters = mergeSchemaLinkFilters(activeSpec.filters, mapped);
      }

      const structuralAlt = resolveStructuralScalarSpec(metas, plan, opts.schemaGround, opts.executionShape);
      if (structuralAlt) {
        const altWithFilters = { ...structuralAlt, filters: mergeSchemaLinkFilters(structuralAlt.filters, mappedFilters) };
        const altValidated = validateSpec(altWithFilters, metas);
        if (altValidated) {
          const llmScore = scoreSchemaLinkSpec(activeSpec, plan, metas, mappedFilters);
          const altScore = scoreSchemaLinkSpec(altValidated, plan, metas, altValidated.filters);
          if (altScore > llmScore + 4) spec = altValidated;
        }
      } else if (slots.length && mappedFilters.length) {
        spec = { ...activeSpec, filters: mappedFilters };
      }
    }
    if (slots.length) {
      const mapped = await mapFilterSlotsToSchemaFilters(model, {
        question: q,
        queryPlan: plan,
        anchorTable: spec.anchor_table,
        metas,
        existingFilters: spec.filters,
      });
      if (mapped?.length) {
        spec = { ...spec, filters: mergeSchemaLinkFilters(spec.filters, mapped) };
      }
    }
    return mergeResultModeIntoSpec(
      expandSpecForDetailRecord(spec, metas, plan ?? ({} as QueryPlan), opts.executionShape),
      {
        executionShape: opts.executionShape,
        resultCardinality: spec.result_cardinality,
        planLimit: plan?.limit,
      },
    );
  } catch {
    return null;
  }
}

function schemaGroundRelationsHint(schemaGround?: SchemaGroundResult | null): string {
  const rels = schemaGround?.relations ?? [];
  if (!rels.length) return "";
  const lines = rels.slice(0, 8).map((r) => `- ${r.from_table}.${r.from_column} → ${r.to_table}.${r.to_column}`);
  return `表关联：\n${lines.join("\n")}`;
}
