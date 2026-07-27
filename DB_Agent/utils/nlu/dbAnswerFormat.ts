/**
 * 查询结果回复格式化：仅依据 QueryPlan / executionShape / 列注释，不对用户问句做正则分类。
 */
import type { QueryPlan } from "./query_plan";
import type { QueryExecutionShape } from "./dbQueryExecutionShapeLlm";

export type ScalarColumnCandidate = { key: string; label: string };

/** 复杂查询：多槽位属性/关联、分组、对比、趋势（结构性，不读问句） */
export function queryPlanLooksComplex(plan?: QueryPlan | null): boolean {
  if (!plan) return false;
  if (plan.intent === "comparison" || plan.intent === "trend") return true;
  if ((plan.dimensions?.length ?? 0) > 0) return true;
  const slots = plan.filters?.slots?.length ?? 0;
  const metrics = plan.metrics?.length ?? 0;
  if (slots >= 1 && metrics >= 1) return true;
  if ((plan.filters?.where?.length ?? 0) >= 2 && metrics >= 1) return true;
  return false;
}

/**
 * Plan.metrics 是否明确要查联系方式（属性查询放行手机号列；全表 dump 仍脱敏）。
 * 只读 metrics，不解析用户原话。
 */
export function planRequestsContactReveal(plan?: QueryPlan | null): boolean {
  if (!plan) return false;
  const blob = (plan.metrics ?? []).join(" ").toLowerCase();
  if (!blob) return false;
  return /手机|电话|联系方式|联系电话|phone|mobile|tel/.test(blob);
}

/** 是否为「统计条数」类查询（只看 plan.metrics，不看问句） */
export function isCountQueryFromPlan(plan?: QueryPlan | null): boolean {
  if (!plan) return false;
  const blob = (plan.metrics ?? []).join(" ").toLowerCase();
  if (/\bcount\b/.test(blob)) return true;
  if (plan.metrics?.some((m) => /^(记录数|条数|数量|个数)$/.test(String(m).trim()))) return true;
  return false;
}

function normalize(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

function scoreLabelAgainstMetrics(label: string, key: string, metrics: string[]): number {
  const blob = normalize(`${label} ${key}`);
  let score = 0;
  for (const m of metrics) {
    const t = normalize(m);
    if (t.length < 2) continue;
    if (blob.includes(t) || t.includes(blob)) score += Math.min(t.length, 10);
  }
  return score;
}

/** 用 plan.metrics 匹配应展示的列（无 LLM、无问句正则） */
export function pickColumnsByPlanMetrics(
  plan: QueryPlan | null | undefined,
  available: ScalarColumnCandidate[],
): string[] | null {
  const metrics = plan?.metrics?.filter(Boolean) ?? [];
  if (!metrics.length || !available.length) return null;
  const ranked = available
    .map((a) => ({ a, score: scoreLabelAgainstMetrics(a.label, a.key, metrics) }))
    .sort((x, y) => y.score - x.score);
  if (!ranked[0]?.score) return null;
  const top = ranked[0]!.score;
  const picked = ranked.filter((r) => r.score >= top * 0.85).map((r) => r.a.key);
  return picked.length ? picked : null;
}

export function primaryMetricLabel(plan?: QueryPlan | null): string {
  const m = plan?.metrics?.find((x) => String(x ?? "").trim());
  return m ? String(m).trim() : "查询结果";
}

/** metrics 是否与筛槽 hint 同名（如错把「课程名称」写成目标属性） */
export function metricOverlapsFilterHint(plan?: QueryPlan | null): boolean {
  const label = primaryMetricLabel(plan);
  if (!label || label === "查询结果") return false;
  return (plan?.filters?.slots ?? []).some((s) => {
    const h = String(s.field_hint ?? "").trim();
    return h && (h === label || h.includes(label) || label.includes(h));
  });
}

/** 单值 scalar 回复（如 总分：152.00） */
export function formatSingleScalarValue(
  plan: QueryPlan | null | undefined,
  value: string,
  opts?: { columnLabel?: string },
): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (isCountQueryFromPlan(plan)) return `查询结果：共有 ${v} 条。`;
  const col = String(opts?.columnLabel ?? "").trim();
  if (col) return `${col}：${v}`;
  if (metricOverlapsFilterHint(plan)) return `查询结果：${v}`;
  const label = primaryMetricLabel(plan);
  return `${label}：${v}`;
}

/** humanize / Agent 单值兜底：优先 plan，避免把「总分」当成「条数」 */
export function formatValueWithPlan(
  value: unknown,
  plan?: QueryPlan | null,
  executionShape?: QueryExecutionShape | null,
): string {
  const v = String(value ?? "").trim();
  if (!v) return "按当前条件没有查到可直接展示的值；换个说法或补充一点条件，我可以再查。";
  if (executionShape === "scalar_lookup" || (plan?.metrics?.length && !isCountQueryFromPlan(plan))) {
    if (/^\d+(?:\.\d+)?$/.test(v) && plan?.metrics?.length) {
      return formatSingleScalarValue(plan, v);
    }
    if (plan?.metrics?.length) {
      if (metricOverlapsFilterHint(plan)) return `查询结果：${v}`;
      return `${primaryMetricLabel(plan)}：${v}`;
    }
  }
  if (isCountQueryFromPlan(plan) && /^\d+(?:\.\d+)?$/.test(v)) {
    return `查询结果：共有 ${v} 条。`;
  }
  return `查询结果：${v}。`;
}
