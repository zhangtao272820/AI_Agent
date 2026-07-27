/** 用户是否点名知识库/文档数据源 — 由路由模型 needsClarify/rationale 表达，此处恒 false 避免正则误判。 */
export function isKnowledgeBaseAnchoredQuery(_text: string): boolean {
  return false
}

/** 结构化库表用语锚定 — 仅识别内嵌 SQL 片段（技术特征，非业务词表）。 */
export function isStructuredDatabaseAnchoredQuery(text: string): boolean {
  const q = String(text ?? '').trim()
  if (!q) return false
  return /\b(select|from|join|where)\b/i.test(q)
}

export function percentile(arr: number[], p: number) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1))
  return Math.round(sorted[idx] || 0)
}
