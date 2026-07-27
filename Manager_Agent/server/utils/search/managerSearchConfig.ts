/** 联网检索预算：由 MANAGER_WEB_SEARCH_MODE 档位决定，单项 env 可覆盖 */

import { webSearchPresetInt } from './managerWebSearchMode'

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** 每轮最多向搜索引擎发送的子 query 数 */
export function searchMaxQueriesPerRound(): number {
  return envInt('MANAGER_SEARCH_MAX_QUERIES', webSearchPresetInt('MANAGER_SEARCH_MAX_QUERIES', 'maxQueries'), 1, 4)
}

/** 单次检索 max_results */
export function searchResultsPerQuery(): number {
  return envInt('MANAGER_SEARCH_RESULTS_PER_QUERY', webSearchPresetInt('MANAGER_SEARCH_RESULTS_PER_QUERY', 'resultsPerQuery'), 1, 8)
}

/** 合并去重后保留的 SERP 命中上限（摘要 / 过滤用） */
export function searchMaxHits(): number {
  return envInt('MANAGER_SEARCH_MAX_HITS', webSearchPresetInt('MANAGER_SEARCH_MAX_HITS', 'maxHits'), 2, 24)
}

/** 传给 Extractor 的 seed_urls 上限 */
export function searchMaxSeeds(): number {
  return envInt('MANAGER_SEARCH_MAX_SEEDS', webSearchPresetInt('MANAGER_SEARCH_MAX_SEEDS', 'maxSeeds'), 1, 12)
}

/** 同域名最多保留几条种子（避免单一站点占满） */
export function searchMaxSeedsPerDomain(): number {
  return envInt(
    'MANAGER_SEARCH_MAX_SEEDS_PER_DOMAIN',
    webSearchPresetInt('MANAGER_SEARCH_MAX_SEEDS_PER_DOMAIN', 'maxSeedsPerDomain'),
    1,
    3
  )
}
