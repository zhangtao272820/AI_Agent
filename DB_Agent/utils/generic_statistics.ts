/**
 * 通用统计模板：非 domain skill 时，基于 schema 接地结果做 GROUP BY / 趋势 COUNT。
 * 仅当执行形态为 distribution/trend 时启用；scalar_lookup 交 QueryIR/LLM。
 * 必须尊重 table_judge.primary_tables；有过滤槽位时禁止无 WHERE 的裸 GROUP BY。
 */
import type { DataSource } from "typeorm";
import type { ChatOpenAI } from "@langchain/openai";
import { sanitizeAssistantText } from "./text";
import type { QueryPlan } from "./nlu/query_plan";
import {
  enforceSelectLimit,
  injectMysqlMaxExecutionTimeHint,
  isReadOnlySelectSql,
} from "./sql_safety";
import { resolveStatColumns, columnLooksLikeTypeDim, dimHintsWantTypeColumn, type ColMeta } from "./nlu/dbSchemaColumnLlm";
import { tryMetricsDirect } from "./metrics_compiler";
import { getDbAgentBlueprintEnv } from "./db_agent_env";
import {
  resolveQueryExecutionShape,
  shapeUsesGenericDistribution,
  planLooksLikeFilteredScalarQuery,
} from "./nlu/dbQueryExecutionShapeLlm";
import { orderTablesForGenericStats, planHasBusinessFilters } from "./generic_statistics_policy";

export {
  planLooksLikeFilteredScalarQuery,
  planWantsDistributionStats,
} from "./nlu/dbQueryExecutionShapeLlm";
export { orderTablesForGenericStats, planHasBusinessFilters } from "./generic_statistics_policy";

async function wantsGenericStats(
  model: ChatOpenAI | null,
  question: string,
  plan?: QueryPlan | null,
): Promise<boolean> {
  const intent = plan?.intent;
  if (intent === "detail") return false;
  if (!(intent === "aggregation" || intent === "trend" || intent === "comparison")) return false;
  if (planLooksLikeFilteredScalarQuery(plan)) return false;
  // 有地区/年龄等过滤时，裸 GROUP BY 会落到无关账号表并丢过滤 → 交 QueryIR / sql_agent
  if (planHasBusinessFilters(plan) && intent !== "trend") return false;

  const resolved = await resolveQueryExecutionShape(model, question, plan);
  if (!shapeUsesGenericDistribution(resolved.shape)) return false;

  const dimCount = plan?.dimensions?.filter(Boolean).length ?? 0;
  if (resolved.shape === "distribution" && dimCount === 0 && resolved.source !== "llm") {
    return false;
  }
  if (resolved.shape === "distribution" && dimCount === 0 && (plan?.filters?.slots?.length ?? 0) > 0) {
    return false;
  }
  return true;
}

async function listTableColumns(ds: DataSource, table: string): Promise<ColMeta[]> {
  const rows = await ds.query(
    `SELECT column_name AS name, COALESCE(column_comment, '') AS comment
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?
     ORDER BY ordinal_position`,
    [table],
  );
  return Array.isArray(rows)
    ? (rows as any[]).map((r) => ({
        name: String(r?.name ?? "").trim(),
        comment: String(r?.comment ?? "").trim(),
      })).filter((c) => c.name)
    : [];
}

function quoteId(id: string) {
  return `\`${String(id).replace(/`/g, "")}\``;
}

async function execSafeSelect(ds: DataSource, sql: string): Promise<any[] | null> {
  const checked = isReadOnlySelectSql(sql);
  if (!checked.ok) return null;
  const limited = enforceSelectLimit(checked.sql, 100, 30);
  const withHint = injectMysqlMaxExecutionTimeHint(limited, 8000);
  try {
    const rows = await ds.query(withHint);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

function renderDistribution(title: string, rows: any[], labelKey: string, countKey = "count"): string {
  if (!rows.length) return "";
  const lines = [title];
  for (const r of rows.slice(0, 25)) {
    const label = String(r?.[labelKey] ?? "未知");
    const count = r?.[countKey] ?? 0;
    lines.push(`- ${label}：${count}`);
  }
  return sanitizeAssistantText(lines.join("\n"));
}

function renderTrend(title: string, rows: any[], periodKey: string, countKey = "count"): string {
  if (!rows.length) return "";
  const lines = [title];
  for (const r of rows.slice(0, 36)) {
    lines.push(`- ${r?.[periodKey] ?? "?"}：${r?.[countKey] ?? 0}`);
  }
  return sanitizeAssistantText(lines.join("\n"));
}

/**
 * 基于候选表 + 查询计划尝试通用统计 SQL；失败返回 null（交 sql_direct / sql_agent）。
 */
export async function tryGenericStatistics(
  ds: DataSource,
  opts: {
    question: string;
    queryPlan?: QueryPlan | null;
    candidateTables?: string[];
    primaryTables?: string[];
    rankedTables?: string[];
    nluModel?: ChatOpenAI | null;
  },
): Promise<string | null> {
  const question = String(opts.question ?? "").trim();
  const plan = opts.queryPlan ?? null;

  if (plan?.intent === "detail" && (plan.entities?.names?.length ?? 0) > 0) return null;

  if (plan?.intent === "detail") return null;

  if (!(await wantsGenericStats(opts.nluModel ?? null, question, plan))) return null;

  const tables = orderTablesForGenericStats({
    candidateTables: opts.candidateTables,
    primaryTables: opts.primaryTables,
    rankedTables: opts.rankedTables,
  });
  if (!tables.length) return null;

  // 有 judge 主表时只查主表，避免候选噪声表（如账号表 Gender）抢答
  const primary = (opts.primaryTables ?? []).map((t) => String(t ?? "").trim()).filter(Boolean);
  const primaryOnly = primary.length ? tables.filter((t) => primary.includes(t)).slice(0, 2) : [];
  const walk = primaryOnly.length > 0 ? primaryOnly : tables;

  if (getDbAgentBlueprintEnv().enableMetricsDirect) {
    const metricsHit = await tryMetricsDirect(ds, question, plan);
    if (metricsHit) return metricsHit.answer;
  }

  const dimHints = [
    ...(plan?.dimensions ?? []),
    ...(plan?.metrics ?? []),
    ...(plan?.filters?.where ?? []),
  ];
  const isTrend = plan?.intent === "trend";

  for (const table of walk) {
    const cols = await listTableColumns(ds, table);
    if (!cols.length) continue;
    const picked = await resolveStatColumns(opts.nluModel ?? null, {
      table,
      columns: cols,
      queryPlan: plan,
      question,
      dimHints,
    });
    const tCol = picked.timeCol;
    const dCol = picked.dimCol;

    if (isTrend && tCol) {
      const sql = `SELECT DATE_FORMAT(${quoteId(tCol)}, '%Y-%m') AS period, COUNT(*) AS count FROM ${quoteId(table)} WHERE ${quoteId(tCol)} IS NOT NULL GROUP BY period ORDER BY period LIMIT 36`;
      const rows = await execSafeSelect(ds, sql);
      if (rows && rows.length > 0) {
        return renderTrend(`按时间趋势统计（表 ${table}）：`, rows, "period");
      }
    }

    if (dCol) {
      const dimMeta = cols.find((c) => c.name === dCol);
      if (
        dimMeta &&
        columnLooksLikeTypeDim(dimMeta) &&
        !dimHintsWantTypeColumn(dimHints)
      ) {
        continue;
      }
      const sql = `SELECT ${quoteId(dCol)} AS label, COUNT(*) AS count FROM ${quoteId(table)} WHERE ${quoteId(dCol)} IS NOT NULL GROUP BY ${quoteId(dCol)} ORDER BY count DESC LIMIT 25`;
      const rows = await execSafeSelect(ds, sql);
      if (rows && rows.length > 0) {
        return renderDistribution(`按 ${dCol} 分布统计（表 ${table}）：`, rows, "label");
      }
    }
  }

  return null;
}
