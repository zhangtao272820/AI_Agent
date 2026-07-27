import type { WebSearchHit } from './webSearchTool'
import { webSearchFlag, webSearchPresetInt } from './managerWebSearchMode'

export type SearchVerifyResult = {
  sufficient: boolean
  score: number
  missing: string[]
  supplementalQueries: string[]
  note: string
  llmTokens?: number
}

export function isSearchVerifyEnabled(): boolean {
  return webSearchFlag('MANAGER_SEARCH_VERIFY', true, false)
}

export function isSearchLoopEnabled(): boolean {
  if (!isSearchVerifyEnabled()) return false
  return webSearchFlag('MANAGER_SEARCH_LOOP', true, false)
}

export function maxSearchRounds(): number {
  const fallback = webSearchPresetInt('MANAGER_SEARCH_MAX_ROUNDS', 'maxRounds')
  const n = Number(process.env.MANAGER_SEARCH_MAX_ROUNDS ?? fallback)
  return Number.isFinite(n) && n >= 1 ? Math.min(5, Math.floor(n)) : fallback
}

function hitTextBlob(h: WebSearchHit): string {
  return `${h.title} ${h.url} ${h.snippet}`.toLowerCase()
}

/** 评估 SERP 是否足够支撑后续 crawler（轻量规则，P2 基础版） */
export function verifySearchCoverage(
  hits: WebSearchHit[],
  plan: import('./managerSearchPlanner').SearchPlan,
  opts?: { minUrlCount?: number }
): SearchVerifyResult {
  const minUrls = Math.max(1, Number(opts?.minUrlCount ?? 2))
  const urls = hits.map((h) => String(h.url ?? '').trim()).filter((u) => /^https?:\/\//i.test(u))
  const uniqueUrls = [...new Set(urls)]

  const missing: string[] = []
  let evidenceScore = 0
  const blob = hits.map(hitTextBlob).join('\n')

  for (const ev of plan.expectedEvidence) {
    const key = String(ev ?? '').slice(0, 40)
    if (!key) continue
    const tokens = key.replace(/[^\p{L}\p{N}]/gu, ' ').split(/\s+/).filter((x) => x.length >= 2)
    const hit = tokens.length === 0 || tokens.some((tok) => blob.includes(tok.toLowerCase())) || uniqueUrls.length >= minUrls
    if (hit) evidenceScore += 1
    else missing.push(key)
  }

  const urlOk = uniqueUrls.length >= minUrls
  const subQ = plan.subQueries.length
  const subCoverage =
    subQ <= 1
      ? true
      : plan.subQueries.filter((q) => {
          const t = q.toLowerCase().slice(0, 24)
          return blob.includes(t) || hits.some((h) => hitTextBlob(h).includes(t.slice(0, 12)))
        }).length >= Math.min(subQ, Math.max(1, Math.ceil(subQ * 0.5)))

  const score =
    uniqueUrls.length === 0
      ? 0
      : Math.min(1, (uniqueUrls.length / minUrls) * 0.5 + (evidenceScore / Math.max(1, plan.expectedEvidence.length)) * 0.3 + (subCoverage ? 0.2 : 0))

  const sufficient = urlOk && score >= 0.55 && (missing.length <= 1 || uniqueUrls.length >= minUrls + 1)

  const supplementalQueries: string[] = []
  if (!sufficient && plan.subQueries.length) {
    for (const q of plan.subQueries) {
      const covered = hits.some((h) => hitTextBlob(h).includes(q.toLowerCase().slice(0, 16)))
      if (!covered) supplementalQueries.push(q)
    }
    if (!supplementalQueries.length && missing.length) {
      supplementalQueries.push(`${plan.subQueries[0] ?? ''} ${missing[0]}`.trim().slice(0, 200))
    }
  }

  return {
    sufficient,
    score,
    missing,
    supplementalQueries: [...new Set(supplementalQueries)].slice(0, 2),
    note: sufficient
      ? `覆盖度 ${(score * 100).toFixed(0)}%，URL ${uniqueUrls.length} 个`
      : `覆盖不足（${(score * 100).toFixed(0)}%），缺 URL 或证据：${missing.join('、') || '子 query 未命中'}`
  }
}
