/** 列与 QueryPlan.metrics 的语义对齐打分（结构/明细列选择共用） */

export function columnLooksNumeric(dataType: string): boolean {
  const t = String(dataType ?? "").toLowerCase();
  return /int|decimal|numeric|float|double|real/.test(t);
}

export function scoreColumnAgainstMetrics(
  col: { name: string; comment: string; data_type?: string },
  metrics: string[],
  tableComment = "",
): number {
  const blob = `${col.name} ${col.comment} ${tableComment}`.toLowerCase();
  let score = 0;
  for (const m of metrics) {
    const t = String(m ?? "").trim().toLowerCase();
    if (t.length < 2) continue;
    if (blob.includes(t)) score += Math.min(t.length, 12);
    const comment = String(col.comment ?? "").trim().toLowerCase();
    if (comment && t.includes(comment)) score += comment.length;
    if (comment && comment.includes(t)) score += Math.min(t.length, 8);
  }
  if (col.data_type && columnLooksNumeric(col.data_type)) {
    for (const m of metrics) {
      const t = String(m ?? "").trim().toLowerCase();
      if (t.includes("分") || t.includes("总") || t.includes("数") || t.includes("score") || t.includes("total")) {
        score += 4;
      }
    }
  }
  return score;
}
