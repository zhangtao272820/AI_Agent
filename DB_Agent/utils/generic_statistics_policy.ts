/**
 * generic_statistics 策略纯函数（无 DataSource / env 依赖）。
 */
import type { QueryPlan } from "./nlu/query_plan";

/** 计划是否带业务过滤（地区/年龄/人名/where/slots）——有则禁止无 WHERE 的裸分布统计 */
export function planHasBusinessFilters(plan?: QueryPlan | null): boolean {
  if (!plan) return false;
  if ((plan.entities?.locations?.length ?? 0) > 0) return true;
  if ((plan.entities?.names?.length ?? 0) > 0) return true;
  if ((plan.filters?.where?.filter(Boolean).length ?? 0) > 0) return true;
  if (
    (plan.filters?.slots ?? []).some(
      (s) => String(s.field_hint ?? "").trim() || String(s.sql_match_value || s.value || "").trim(),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * 统计表遍历顺序：智能选表 primary 优先，再 ranked，最后其余候选。
 * 禁止「候选列表里第一个碰巧有 Gender 列的表」抢赢主表。
 */
export function orderTablesForGenericStats(opts: {
  candidateTables?: string[] | null;
  primaryTables?: string[] | null;
  rankedTables?: string[] | null;
}): string[] {
  const candidates = (opts.candidateTables ?? []).map((t) => String(t ?? "").trim()).filter(Boolean);
  const primary = (opts.primaryTables ?? []).map((t) => String(t ?? "").trim()).filter(Boolean);
  const ranked = (opts.rankedTables ?? []).map((t) => String(t ?? "").trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    if (!t || seen.has(t)) return;
    if (!candidates.includes(t) && !primary.includes(t) && !ranked.includes(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const t of primary) push(t);
  for (const t of ranked) push(t);
  for (const t of candidates) push(t);
  return out.slice(0, 4);
}
