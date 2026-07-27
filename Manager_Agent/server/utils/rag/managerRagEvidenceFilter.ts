/**
 * 总管侧：按问句词面重合过滤 retrieve 证据（与 RAG retrieval_shared 逻辑对齐，避免跨服务 import）。
 */

export type RetrieveEvidenceRow = { content?: string; source?: string }

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase()
  const ascii = normalized.match(/[a-z0-9_]+/g) ?? []
  const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const terms = new Set<string>()
  for (const t of ascii) {
    if (t.length >= 2) terms.add(t)
  }
  for (const t of cjk) {
    terms.add(t)
    if (t.length >= 4) {
      for (let i = 0; i <= t.length - 2; i += 1) terms.add(t.slice(i, i + 2))
    }
  }
  return Array.from(terms)
}

function overlapScore(query: string, text: string): number {
  const terms = tokenize(query)
  if (!terms.length) return 0
  const blob = String(text ?? '').toLowerCase()
  let score = 0
  for (const t of terms) {
    if (!t || !blob.includes(t)) continue
    score += t.length >= 3 ? 2 : 1
  }
  return score
}

/** 过滤与检索问句主题词面重合度过低的证据块（多来源时也过滤，避免跨文档污染） */
export function filterRetrieveEvidenceForQuery(
  stepQuery: string,
  evidence: RetrieveEvidenceRow[]
): RetrieveEvidenceRow[] {
  const rows = (Array.isArray(evidence) ? evidence : [])
    .map((e) => ({
      content: String(e?.content ?? '').trim(),
      source: String(e?.source ?? '').trim()
    }))
    .filter((e) => e.content || e.source)
  if (rows.length <= 1) return rows

  const scored = rows.map((e) => ({
    e,
    score: overlapScore(stepQuery, `${e.source}\n${e.content}`)
  }))
  const best = Math.max(...scored.map((s) => s.score), 0)
  if (best <= 0) return rows.slice(0, Math.min(rows.length, 3))

  const kept = scored.filter((s) => s.score >= Math.max(2, best * 0.38))
  const sorted = (kept.length ? kept : scored).sort((a, b) => b.score - a.score)
  return sorted.slice(0, 10).map((s) => s.e)
}
