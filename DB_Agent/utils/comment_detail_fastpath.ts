/**
 * 窄域明细快路径：仅在 Schema Judge 已明确注释对齐 + 按人查明细时，0 次 SQL 生成 LLM。
 * 绝大多数问句仍走 sql_direct / QueryIR / sql_agent。
 */
import type { DataSource } from "typeorm";
import type { QueryPlan } from "./nlu/query_plan";
import { planWantsFullRecordFieldsStructural } from "./nlu/dbSqlOutputShapeLlm";
import {
  collectDetailFastPathIntentTokens,
  rankDetailTablesByIntent,
} from "./detail_fastpath_align";
import { resolvePersonNameFromPlanOrQuestion } from "./query_route_policy";
import { loadTablesMeta, tryPrimaryTableDetailByName } from "./schema_relations";
import type { SchemaGroundResult } from "./schema_ground";
import { sanitizeAssistantText } from "./text";

export type CommentDetailFastPathResult = {
  answer: string;
  sql: string;
  rowCount: number;
  table: string;
};

/** Plan 是否属于「按人查业务明细」形态（仅用 plan 槽位） */
export function planLooksLikePersonDetailQuery(
  plan?: QueryPlan | null,
  executionShape?: string | null,
): boolean {
  if (!plan) return false;
  if (plan.intent === "detail") return true;
  if (executionShape === "detail_rows" && (plan.entities?.names?.length ?? 0) > 0) return true;
  if ((plan.entities?.names?.length ?? 0) > 0 && planWantsFullRecordFieldsStructural(plan)) return true;
  return planWantsFullRecordFieldsStructural(plan) && (plan.entities?.names?.length ?? 0) > 0;
}

/** 仅当 Judge 已明确表注释对齐时才允许快路径（避免误把任意单主表当快路径） */
export function schemaHasCommentAlignedPrimary(schemaGround?: SchemaGroundResult | null): boolean {
  const reasoning = String(schemaGround?.table_judge?.reasoning ?? "");
  return reasoning.includes("表注释对齐") || reasoning.includes("表注释启发");
}

export function resolveDetailPersonName(plan: QueryPlan | null | undefined, question: string): string {
  const fromPlan = resolvePersonNameFromPlanOrQuestion(plan ?? ({} as QueryPlan), question);
  if (fromPlan) return fromPlan;
  const names = (plan?.entities?.names ?? []).map((n) => String(n ?? "").trim()).filter(Boolean);
  return names[0] ?? "";
}

export function shouldUseCommentAlignedDetailFastPath(input: {
  plan?: QueryPlan | null;
  schemaGround?: SchemaGroundResult | null;
  question: string;
  executionShape?: string | null;
}): boolean {
  if (!planLooksLikePersonDetailQuery(input.plan, input.executionShape)) return false;
  if (!schemaHasCommentAlignedPrimary(input.schemaGround)) return false;
  return Boolean(resolveDetailPersonName(input.plan, input.question));
}

export async function runCommentAlignedDetailFastPath(
  ds: DataSource,
  input: {
    question: string;
    queryPlan?: QueryPlan | null;
    schemaGround?: SchemaGroundResult | null;
    limit?: number;
  },
): Promise<CommentDetailFastPathResult | null> {
  if (!shouldUseCommentAlignedDetailFastPath(input)) return null;

  const personName = resolveDetailPersonName(input.queryPlan, input.question);
  if (!personName) return null;

  const judge = input.schemaGround?.table_judge;
  const candidates = input.schemaGround?.candidate_tables ?? [];
  const auxiliary = new Set(judge?.auxiliary_tables ?? []);
  const ordered = (judge?.ranked_tables?.length ? judge.ranked_tables : candidates).filter(
    (t) => t && !auxiliary.has(t),
  );
  if (!ordered.length) return null;

  const intentTokens = collectDetailFastPathIntentTokens(input.question, input.queryPlan);
  const primaryFirst = (judge?.primary_tables ?? []).filter((t) => t && !auxiliary.has(t));
  let tablesToTry = primaryFirst.length
    ? [...new Set([...primaryFirst, ...ordered])].slice(0, 4)
    : ordered.slice(0, 4);

  if (intentTokens.length) {
    const metas = await loadTablesMeta(ds, ordered.slice(0, 6));
    const aligned = rankDetailTablesByIntent(metas, intentTokens, ordered);
    if (aligned.length) tablesToTry = aligned.slice(0, 4).map((x) => x.name);
  }

  const limit = Math.max(1, Math.min(20, Number(input.limit ?? 5)));
  const tried = new Set<string>();
  const tryTable = async (table: string) => {
    if (!table || auxiliary.has(table) || tried.has(table)) return null;
    tried.add(table);
    const hit = await tryPrimaryTableDetailByName(ds, { table, personName, limit });
    if (!hit?.rows?.length) return null;
    const body = formatDetailRows(hit.rows);
    const answer = sanitizeAssistantText(
      body
        ? `根据您的查询，找到 ${hit.rows.length} 条相关记录：\n\n${body}`
        : "查询已完成，但未返回可展示字段。",
    );
    return { answer, sql: hit.sql, rowCount: hit.rows.length, table: hit.table };
  };

  for (const table of tablesToTry) {
    const hit = await tryTable(table);
    if (hit) return hit;
  }
  for (const table of ordered.slice(0, 6)) {
    const hit = await tryTable(table);
    if (hit) return hit;
  }
  return null;
}

function formatDetailRows(rows: Record<string, unknown>[]): string {
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    lines.push(`记录 ${i + 1}：`);
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined || String(v).trim() === "") continue;
      lines.push(`- ${k}：${String(v)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
