/** P3：从 graph state.meta 提取联网搜索指标，供学习信号与失败归因复用 */

export type SearchRunMetrics = {
  webSearchMode?: string
  needsWebSearch?: boolean
  searchRequested: boolean
  searchHitCount: number
  seedUrlCount: number
  searchRounds: number
  searchFailed: boolean
  searchError?: string
}

export function extractSearchRunMetrics(state: any): SearchRunMetrics {
  const meta = state?.meta && typeof state.meta === 'object' ? state.meta : {}
  const mode = String(meta.webSearchMode || '').trim()
  const needsWebSearch = meta.needsWebSearch === true
  const searchHits = Array.isArray(meta.searchHits) ? meta.searchHits : []
  const seedUrls = Array.isArray(meta.seedUrls) ? meta.seedUrls : []
  const searchError = String(meta.searchError || '').trim()
  const searchRequested =
    needsWebSearch ||
    mode === 'loop' ||
    mode === 'done' ||
    (mode !== 'off' && mode !== 'skip' && mode !== '')
  return {
    webSearchMode: mode || undefined,
    needsWebSearch: needsWebSearch || undefined,
    searchRequested,
    searchHitCount: searchHits.length,
    seedUrlCount: seedUrls.length,
    searchRounds: Number(meta.searchRounds ?? 0) || 0,
    searchFailed: searchRequested && searchHits.length === 0 && Boolean(searchError),
    searchError: searchError || undefined
  }
}

export function searchMetricsForLearning(metrics: SearchRunMetrics) {
  return {
    webSearchMode: metrics.webSearchMode,
    needsWebSearch: metrics.needsWebSearch,
    searchRequested: metrics.searchRequested,
    searchHitCount: metrics.searchHitCount,
    seedUrlCount: metrics.seedUrlCount,
    searchRounds: metrics.searchRounds,
    searchFailed: metrics.searchFailed
  }
}
