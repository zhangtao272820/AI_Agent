/**
 * Schema 接地后的槽位精炼（DIN-SQL / MAC-SQL 风格 Selector + Decomposer）。
 * 在已知表结构/列注释/样例值后，精炼 filter_slots 与 metrics，供 Schema Linking / SQL 生成使用。
 * 不对问句做业务正则；样例值仅来自 information_schema + DISTINCT 采样。
 */
import { z } from "zod";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { DataSource } from "typeorm";
import type { QueryPlan } from "./query_plan";
import type { SchemaGroundResult } from "../schema_ground";
import { loadTableColumnMeta, expandMetasForJsonArrayJoins, type TableColumnMeta } from "./dbSchemaLinkLlm";
import { scoreColumnForFieldHint } from "./dbFilterSlotMapLlm";
import { incrementLlmCallCount } from "../llm_call_counter";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";
import { clipText } from "./text";

const RefineSchema = z.object({
  metrics: z.array(z.string()).max(12).optional(),
  dimensions: z.array(z.string()).max(8).optional(),
  entities: z
    .object({
      locations: z.array(z.string()).max(8).optional(),
    })
    .optional(),
  filters: z
    .object({
      where: z.array(z.string()).max(12).optional(),
      slots: z
        .array(
          z.object({
            field_hint: z.string(),
            value: z.string(),
            sql_match_value: z.string(),
          }),
        )
        .max(12)
        .optional(),
    })
    .optional(),
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

export function isDbQuerySlotSchemaRefineEnabled(): boolean {
  return isDbNluFeatureEnabled("slot_schema_refine");
}

function isAuditOrIdColumn(name: string): boolean {
  const k = String(name ?? "").toLowerCase();
  if (k === "id" || k.endsWith("_id")) return true;
  return ["create_time", "update_time", "created_at", "updated_at", "deleted", "is_deleted"].includes(k);
}

function isSampleableType(dataType: string): boolean {
  const t = String(dataType ?? "").toLowerCase();
  return t.includes("char") || t.includes("text") || t.includes("json") || t === "enum";
}

function pickSampleColumns(meta: TableColumnMeta, maxCols: number): string[] {
  const out: string[] = [];
  for (const c of meta.columns) {
    if (out.length >= maxCols) break;
    if (isAuditOrIdColumn(c.name)) continue;
    if (!isSampleableType(c.data_type)) continue;
    out.push(c.name);
  }
  return out;
}

export async function loadColumnValueSamples(
  ds: DataSource,
  metas: TableColumnMeta[],
  opts?: { maxColsPerTable?: number; sampleLimit?: number },
): Promise<Record<string, string[]>> {
  const maxCols = opts?.maxColsPerTable ?? 8;
  const limit = opts?.sampleLimit ?? 6;
  const out: Record<string, string[]> = {};

  for (const meta of metas.slice(0, 4)) {
    const cols = pickSampleColumns(meta, maxCols);
    for (const col of cols) {
      const key = `${meta.table}.${col}`;
      try {
        const rows = await ds.query(
          `SELECT DISTINCT \`${col.replace(/`/g, "")}\` AS v FROM \`${meta.table.replace(/`/g, "")}\` WHERE \`${col.replace(/`/g, "")}\` IS NOT NULL AND CAST(\`${col.replace(/`/g, "")}\` AS CHAR) <> '' LIMIT ?`,
          [limit],
        );
        const vals = (Array.isArray(rows) ? rows : [])
          .map((r) => String((r as { v?: unknown })?.v ?? "").trim())
          .filter((v) => v && v.length <= 120);
        if (vals.length) out[key] = vals;
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

function formatMetaBlock(metas: TableColumnMeta[]): string {
  const lines: string[] = [];
  for (const m of metas) {
    lines.push(`表 ${m.table}${m.table_comment ? ` // ${m.table_comment}` : ""}`);
    for (const c of m.columns.slice(0, 45)) {
      lines.push(`  - ${c.name}${c.comment ? ` // ${c.comment}` : ""} (${c.data_type})`);
    }
  }
  return clipText(lines.join("\n"), 3800);
}

function formatSamplesBlock(samples: Record<string, string[]>): string {
  const lines = Object.entries(samples).map(([k, vals]) => `- ${k}：${vals.join(" | ")}`);
  return lines.length ? lines.join("\n") : "";
}

/** 用列 DISTINCT 样例值精炼 sql_match_value（无 LLM、仅 slot 与样例互含比对） */
export function refineFilterSlotsFromColumnSamples(
  plan: QueryPlan,
  samples: Record<string, string[]>,
  metas: TableColumnMeta[],
): QueryPlan {
  const slots = plan.filters?.slots ?? [];
  if (!slots.length || !Object.keys(samples).length) return plan;

  const refined = slots.map((slot) => {
    const val = String(slot.sql_match_value || slot.value || "").trim();
    if (!val) return slot;
    let bestSample = val;
    let bestScore = 0;
    for (const meta of metas) {
      for (const col of meta.columns) {
        const colScore = scoreColumnForFieldHint(col, slot.field_hint, meta.table_comment);
        if (!colScore) continue;
        const key = `${meta.table}.${col.name}`;
        const sampleVals = samples[key];
        if (!sampleVals?.length) continue;
        for (const sv of sampleVals) {
          const vl = val.toLowerCase();
          const sl = String(sv).trim().toLowerCase();
          if (!sl) continue;
          if (vl.includes(sl) || sl.includes(vl)) {
            const score = colScore + Math.min(sl.length, vl.length);
            if (score > bestScore) {
              bestScore = score;
              bestSample = String(sv).trim();
            }
          }
        }
      }
    }
    if (bestScore > 0 && bestSample !== val) {
      return { ...slot, sql_match_value: bestSample };
    }
    return slot;
  });

  return { ...plan, filters: { ...plan.filters, slots: refined } };
}

function mergeRefinedIntoPlan(plan: QueryPlan, refined: z.infer<typeof RefineSchema>): QueryPlan {
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
  const slotRaw = refined.filters?.slots ?? [];
  const slots = slotRaw
    .map((s) => ({
      field_hint: String(s.field_hint ?? "").trim(),
      value: String(s.value ?? "").trim(),
      sql_match_value: String(s.sql_match_value ?? s.value ?? "").trim(),
    }))
    .filter((s) => s.field_hint || s.value)
    .slice(0, 12);
  const locations = arr(refined.entities?.locations);
  const dimensions = arr(refined.dimensions);

  return {
    ...plan,
    metrics: refined.metrics?.length ? arr(refined.metrics) : plan.metrics,
    dimensions: dimensions.length ? dimensions : plan.dimensions,
    entities: {
      ...plan.entities,
      locations: locations.length ? locations : plan.entities.locations,
    },
    filters: {
      ...plan.filters,
      where: refined.filters?.where?.length ? arr(refined.filters.where) : plan.filters.where,
      slots: slots.length ? slots : plan.filters.slots,
      time_range: { ...plan.filters.time_range },
    },
  };
}

/** Schema 接地后精炼 QueryPlan 槽位（filter_slots / metrics） */
export async function refineQueryPlanWithSchemaGround(
  model: BaseLanguageModel | null,
  ds: DataSource,
  opts: {
    question: string;
    queryPlan: QueryPlan;
    schemaGround: SchemaGroundResult;
  },
): Promise<QueryPlan | null> {
  if (!model || !isDbQuerySlotSchemaRefineEnabled()) return null;
  const q = String(opts.question ?? "").trim();
  const plan = opts.queryPlan;
  if (!q || !plan) return null;

  const tables = [
    ...(opts.schemaGround.table_judge?.primary_tables ?? []),
    ...(opts.schemaGround.candidate_tables ?? []),
  ];
  const uniq = Array.from(new Set(tables.filter(Boolean))).slice(0, 6);
  if (!uniq.length) return null;

  let metas = await loadTableColumnMeta(ds, uniq);
  metas = await expandMetasForJsonArrayJoins(ds, metas);
  if (!metas.length) return null;

  const samples = await loadColumnValueSamples(ds, metas);
  let workingPlan = refineFilterSlotsFromColumnSamples(plan, samples, metas);
  const slotLines = (workingPlan.filters.slots ?? [])
    .map((s) => `- ${s.field_hint}：用户值=${s.value}；当前 sql_match_value=${s.sql_match_value || s.value}`)
    .join("\n");
  const relHint = (opts.schemaGround.relations ?? [])
    .slice(0, 8)
    .map((r) => `- ${r.from_table}.${r.from_column} → ${r.to_table}.${r.to_column}`)
    .join("\n");

  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是 NL2SQL 槽位精炼器（Schema-grounded Decomposer，对标 DIN-SQL/MAC-SQL）。",
          "已知数据库表结构、列注释与部分列样例值，精炼 QueryPlan 中的 metrics、dimensions 与 filter_slots。",
          "只输出 JSON。按 schema 语义理解，勿用问句正则或业务词表硬匹配。",
          "规则：",
          "1) metrics：填用户真正要查的属性/目标列的业务语义（如「绑定题库名称」「总分」「性别分布」）。",
          "2) dimensions：分组维度（如「性别」）；纯人数计数可 []。",
          "3) entities.locations：纯行政区划名；filters.slots：region/location 与 age/age_gte/age_lte。",
          "4) filter_slots：每条含 field_hint、value、sql_match_value（写入 SQL 的值）。",
          "5) sql_match_value 必须结合列注释与样例值：若库中存更短核心词，勿照搬用户长修饰语。",
          "6) 样例值块非空时，sql_match_value 应优先匹配样例中的真实存值。",
          "7) filters.where 可填可读筛选描述，与 filter_slots 一致。",
          "8) 关联属性查询：锚点对象的筛选写入 filter_slots，metrics 只含目标属性（如「题库名称」）；禁止把「课程名称/名字」等筛字段写入 metrics。",
          "8b) schema 含 JSON 数组 ID 列（如 arr_*_id）且问绑定/关联名称时：metrics 必须是目标关联表属性，勿选锚点展示名列。",
          "9) 「题目为X/题目名称是X」→ field_hint 用「题目名称」，sql_match_value 用 X；勿映射到「题目类型」枚举列。",
          "10) 查「选项内容/答案内容/分别是什么」→ metrics 填「选项内容」等；需父表定位 + 子表 JOIN，不是 COUNT 分布。",
          "11) schema 含 age/年龄列且问题含数字年龄区间：必须输出 age_gte 与 age_lte（或 age 区间值）；仅有 region 而无年龄槽视为精炼失败，须补全。",
          "12) 若问题隐含年龄/群体口径且 schema 有对应年龄列 → 写出 age_gte/age_lte（或 age）；取值由语义与列注释推断，勿写死常数。",
          "13) 性别分布：dimensions=[性别]；地区→region；年龄区间→age_*；三者不得互相覆盖。",
          'schema: {"metrics":[],"dimensions":[],"entities":{"locations":[]},"filters":{"where":[],"slots":[{"field_hint":"","value":"","sql_match_value":""}]},"confidence":0-1}',
        ].join("\n"),
      ],
      [
        "human",
        clipText(
          [
            `问题：${q}`,
            `intent=${workingPlan.intent}`,
            workingPlan.metrics.length ? `当前 metrics：${workingPlan.metrics.join("、")}` : "",
            workingPlan.filters.where.length ? `当前 filters.where：${workingPlan.filters.where.join("；")}` : "",
            slotLines ? `当前 filter_slots：\n${slotLines}` : "当前 filter_slots：无（请从问题抽取）",
            relHint ? `表关联：\n${relHint}` : "",
            opts.schemaGround.schema_summary
              ? `Schema 摘要：\n${clipText(opts.schemaGround.schema_summary, 1200)}`
              : "",
            "",
            "详细 Schema：",
            formatMetaBlock(metas),
            formatSamplesBlock(samples) ? `\n列样例值（库中真实 DISTINCT 采样）：\n${formatSamplesBlock(samples)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          4800,
        ),
      ],
    ]);
    const text =
      typeof (res as { content?: string })?.content === "string"
        ? String((res as { content?: string }).content ?? "")
        : "";
    const parsed = RefineSchema.safeParse(safeJsonParse(text));
    const baseHasSlots = (workingPlan.filters.slots?.length ?? 0) > 0;
    const baseHasMetrics = (workingPlan.metrics?.length ?? 0) > 0;
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.35) {
      return baseHasSlots || baseHasMetrics ? workingPlan : null;
    }
    const next = mergeRefinedIntoPlan(workingPlan, parsed.data);
    const hasSlots = (next.filters.slots?.length ?? 0) > 0;
    const hasMetrics = (next.metrics?.length ?? 0) > 0;
    if (!hasSlots && !hasMetrics) return baseHasSlots || baseHasMetrics ? workingPlan : null;
    return next;
  } catch {
    const baseHasSlots = (workingPlan.filters.slots?.length ?? 0) > 0;
    const baseHasMetrics = (workingPlan.metrics?.length ?? 0) > 0;
    return baseHasSlots || baseHasMetrics ? workingPlan : null;
  }
}
