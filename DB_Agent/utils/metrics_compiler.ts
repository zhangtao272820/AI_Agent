/**
 * P3：补丁 metrics.json 直出 SQL（统计/计数类，0 LLM）。
 */
import type { DataSource } from "typeorm";
import type { QueryPlan } from "./nlu/query_plan";
import { loadDomainPatch, type MetricPatch } from "./domain_patch";
import { getDbAgentBlueprintEnv } from "./db_agent_env";
import {
  enforceSelectLimit,
  injectMysqlMaxExecutionTimeHint,
  isReadOnlySelectSql,
} from "./sql_safety";
import { sanitizeAssistantText } from "./text";
import { recordQueryMetric } from "./query_metrics";

function blob(question: string, plan?: QueryPlan | null): string {
  return [
    question,
    ...(plan?.dimensions ?? []),
    ...(plan?.metrics ?? []),
    ...(plan?.filters?.where ?? []),
    plan?.intent ?? "",
  ]
    .join(" ")
    .replace(/\s+/g, "");
}

function scoreMetric(metric: MetricPatch, text: string, plan?: QueryPlan | null): number {
  let score = 0;
  const hints = metric.match_hints ?? [];
  for (const h of hints) {
    const s = String(h ?? "").trim();
    if (s.length >= 2 && text.includes(s)) score += 10;
  }
  if (plan?.intent === "aggregation" || plan?.intent === "trend") score += 2;
  if (metric.id.includes("trend") && plan?.intent === "trend") score += 8;
  if (metric.id.includes("gender") && text.includes("性别")) score += 8;
  if (metric.id.includes("age") && (text.includes("年龄") || text.includes("岁"))) score += 8;
  if (metric.id.includes("foot") && (text.includes("足") || text.includes("足底"))) score += 12;
  if (metric.id.includes("bone") && text.includes("骨密度")) score += 12;
  if (metric.id.includes("psychology") && text.includes("情绪")) score += 12;
    if (metric.id.includes("health_records") && text.includes("健康")) score += 8;
    if (metric.id.includes("schema") && (text.includes("表") || text.includes("schema"))) score += 8;
    if (metric.id.includes("total") && (text.includes("多少") || text.includes("几条") || text.includes("总数"))) score += 6;
  if (metric.id === "person_total_count" && /[\u4e00-\u9fff]{2,8}[市区县]/.test(text)) score -= 24;
  return score;
}

function renderMetricRows(metric: MetricPatch, rows: any[]): string {
  if (!rows.length) return `${metric.title}：未找到数据。`;
  if (rows.length === 1 && rows[0] && typeof rows[0] === "object" && "count" in rows[0]) {
    return `${metric.title}：${rows[0].count}`;
  }
  const keys = Object.keys(rows[0] ?? {});
  const labelKey = keys.find((k) => !/count|total|cnt/i.test(k)) ?? keys[0] ?? "label";
  const countKey = keys.find((k) => /count|total|cnt/i.test(k)) ?? "count";
  const lines = [`${metric.title}：`];
  for (const r of rows.slice(0, 30)) {
    lines.push(`- ${r[labelKey] ?? "未知"}：${r[countKey] ?? 0}`);
  }
  return sanitizeAssistantText(lines.join("\n"));
}

export function resolveMetricPatch(question: string, plan?: QueryPlan | null): MetricPatch | null {
  const env = getDbAgentBlueprintEnv();
  if (!env.enableMetricsDirect) return null;
  const text = blob(question, plan);
  if (!text) return null;
  const metrics = loadDomainPatch().metrics;
  if (!metrics.length) return null;
  const scored = metrics
    .map((m) => ({ m, s: scoreMetric(m, text, plan) }))
    .filter((x) => x.s >= 8)
    .sort((a, b) => b.s - a.s);
  return scored[0]?.m ?? null;
}

export async function tryMetricsDirect(
  ds: DataSource,
  question: string,
  plan?: QueryPlan | null,
): Promise<{ answer: string; metricId: string; sql: string; rows: any[] } | null> {
  const metric = resolveMetricPatch(question, plan);
  if (!metric?.sql) return null;
  const checked = isReadOnlySelectSql(metric.sql);
  if (!checked.ok) return null;
  const limited = enforceSelectLimit(checked.sql, 100, 50);
  const withHint = injectMysqlMaxExecutionTimeHint(limited, 8000);
  try {
    const rows = (await ds.query(withHint)) as any[];
    if (!Array.isArray(rows)) return null;
    recordQueryMetric({ path: "generic_stats", ok: true, empty: rows.length === 0, reason: `metric:${metric.id}` });
    return {
      answer: renderMetricRows(metric, rows),
      metricId: metric.id,
      sql: withHint,
      rows,
    };
  } catch {
    return null;
  }
}

export function listMetricsCatalog() {
  return loadDomainPatch().metrics.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    tables: m.tables,
    match_hints: m.match_hints,
  }));
}
