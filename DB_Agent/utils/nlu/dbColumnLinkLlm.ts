/**
 * 列链接 LLM：将 QueryPlan 中的自然语言条件映射到 schema 列（P6，不用正则拆问句）。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { clipText } from "./text";
import type { QueryPlan } from "./query_plan";
import type { SchemaGroundResult } from "../schema_ground";
import { queryIrFromLlmJson, type QueryIr } from "../query_ir";
import { loadDomainPatch } from "../domain_patch";
import { buildJoinContextBlock } from "../join_path";
import { formatJoinPathPlan } from "../join_path_planner";
import { incrementLlmCallCount } from "../llm_call_counter";

export async function linkColumnsToQueryIr(
  model: BaseLanguageModel,
  opts: {
    question: string;
    queryPlan?: QueryPlan | null;
    schemaGround?: SchemaGroundResult | null;
  },
): Promise<QueryIr | null> {
  const q = String(opts.question ?? "").trim();
  if (!q) return null;
  const tables = opts.schemaGround?.candidate_tables ?? [];
  if (!tables.length) return null;

  const plan = opts.queryPlan;
  const schemaBlock = clipText(opts.schemaGround?.schema_summary ?? "", 1600);
  const joinBlock = buildJoinContextBlock({
    tables: opts.schemaGround?.candidate_tables ?? [],
    relations: opts.schemaGround?.relations,
    queryPlan: opts.queryPlan,
  });
  const joinPlanBlock = formatJoinPathPlan(
    opts.schemaGround?.relations ?? [],
    opts.schemaGround?.candidate_tables ?? [],
  );
  const valueMaps = loadDomainPatch().valueMaps;
  const valueHint =
    Object.keys(valueMaps).length > 0
      ? `\n枚举映射（展示值→库值）：${JSON.stringify(valueMaps).slice(0, 600)}`
      : "";
  const slotBlock =
    plan?.filters?.slots?.length
      ? plan.filters.slots.map((s) => `- ${s.field_hint}：${s.sql_match_value || s.value}`).join("\n")
      : "";
  const prompt = [
    "你是数据库列链接专家。根据用户问题、查询计划与 schema 摘要，输出 QueryIR JSON。",
    "规则：",
    "1) from_tables 从候选表中选取；多表用 joins 写明 ON 条件（依据 schema 外键/注释）。",
    "2) filters 每条含 column（表.列）、op（=,!=,>,<,>=,<=,between,in,is null,like）、value；优先使用 QueryPlan.filter_slots 中的 sql_match_value。",
    "3) 多个条件默认 AND；用户明确「或者」时用 or_groups。",
    "4) 列名必须来自 schema，禁止臆造。",
    "5) 属性/单值查询：select 只填用户要的 1~3 列，use_distinct=true。",
    "6) JSON 数组列关联其它表：from_tables 含主表与关联表，joins 用 JSON_TABLE 展开，select 用 DISTINCT 目标列。",
    "7) 只输出 JSON，无 Markdown。",
    '格式：{"from_tables":[],"joins":[{"type":"inner","on":"a.id=b.person_id"}],"select":[],"filters":[],"use_distinct":true,"limit":10}',
    "",
    `用户问题：${clipText(q, 400)}`,
    plan ? `查询计划：${clipText(JSON.stringify(plan), 600)}` : "",
    slotBlock ? `filter_slots（必须在 filters 落实）：\n${slotBlock}` : "",
    `候选表：${tables.join("、")}`,
    schemaBlock ? `Schema：\n${schemaBlock}` : "",
    joinBlock || "",
    joinPlanBlock || "",
    valueHint,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const resp = await model.invoke(prompt);
    incrementLlmCallCount(1);
    const text =
      typeof (resp as any)?.content === "string" ? (resp as any).content : JSON.stringify((resp as any)?.content);
    return queryIrFromLlmJson(text);
  } catch {
    return null;
  }
}
