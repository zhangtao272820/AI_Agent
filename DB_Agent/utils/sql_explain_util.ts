/** EXPLAIN 预检：仅用于 agentResult.structured，不改变 SQL 执行语义。 */

export function parseExplainInsights(tabularRows: unknown[]): string[] {
  const insights: string[] = [];
  if (!Array.isArray(tabularRows) || tabularRows.length === 0) return insights;
  for (const r of tabularRows as Record<string, unknown>[]) {
    const type = String(r?.type ?? r?.access_type ?? "").toUpperCase();
    const key = String(r?.key ?? r?.key_name ?? "");
    const rows = Number(r?.rows ?? NaN);
    const extra = String(r?.Extra ?? r?.extra ?? "");
    if (type === "ALL" && !key) insights.push("出现全表扫描，优先考虑为过滤/关联条件添加索引");
    if (extra && /Using temporary/i.test(extra)) insights.push("可能产生临时表，建议优化 GROUP BY/ORDER BY 或索引");
    if (extra && /Using filesort/i.test(extra)) insights.push("出现文件排序，建议为排序列建索引");
    if (Number.isFinite(rows) && rows >= 50_000) insights.push("预计扫描行数较大，建议收紧 WHERE 或优化索引");
  }
  return Array.from(new Set(insights)).slice(0, 4);
}

export async function runExplainPreflight(
  ds: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  sql: string,
): Promise<string[]> {
  const s = String(sql ?? "").trim();
  if (!s || !/^\s*(select|with)\b/i.test(s)) return [];
  try {
    const withHint = s.replace(/^\s*(select|with)\b/i, (m) => `${m}`);
    const plan = (await ds.query(`EXPLAIN ${withHint}`)) as unknown;
    return parseExplainInsights(Array.isArray(plan) ? plan : []);
  } catch {
    return [];
  }
}
