/**
 * SERP 混合抓取：参考 Crawlee/Firecrawl 的「搜索摘要 + 选择性深抓」。
 * 高摩擦种子直接用 SERP 摘要；低摩擦种子失败时按 URL 回退 SERP。
 */

import { isSearchEngineResultUrl } from '#agent-shared/crawlUrlQuality'

export type SerpHit = {
  title: string
  url: string
  snippet: string
  source?: string
  crawlRisk?: number
  relevanceScore?: number
  publishedDate?: string
  crawlAction?: 'crawl' | 'serp_only' | 'mcp'
}

export type SerpHybridItem = {
  title: string
  url: string
  source: string
  excerpt: string
  excerpt_source?: string
}

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(String(url ?? '').trim())
    u.hash = ''
    return u.toString().replace(/\/+$/, '')
  } catch {
    return String(url ?? '').trim().replace(/\/+$/, '')
  }
}

/** 与 Manager crawlSeedRisk 对齐 */
export function crawlRiskScore(url: string): number {
  const u = String(url ?? '').trim().toLowerCase()
  if (!u) return 2
  let host = ''
  let path = ''
  try {
    const parsed = new URL(u)
    host = parsed.hostname.toLowerCase()
    path = parsed.pathname.toLowerCase()
  } catch {
    return 2
  }
  const highFrictionHosts = [
    'wenku.baidu.com',
    'wk.baidu.com',
    'xueshu.baidu.com',
    'zhidao.baidu.com',
    'jingyan.baidu.com',
    'iask.sina.com.cn',
    'cnki.net',
    'wanfangdata.com.cn',
    'doc88.com',
    'docin.com',
    'book118.com',
    'ishare.iask.sina.com.cn',
    'mbd.baidu.com',
    'tieba.baidu.com',
  ]
  if (highFrictionHosts.some((h) => host === h || host.endsWith(`.${h}`))) return 2
  if (host.includes('cnki') && /\/article\//i.test(path)) return 2
  if (host.includes('baidu.com') && /\/view\/[a-f0-9]+\.html/i.test(u)) return 2
  if (host.includes('baidu.com') && /\/question\/\d+/i.test(path)) return 2
  if (host.includes('zhihu.com') && path.includes('/question/')) return 2
  const openHosts = ['gov.cn', 'edu.cn', 'org.cn', 'who.int', 'nih.gov', 'wikipedia.org', 'baike.baidu.com']
  if (openHosts.some((h) => host === h || host.endsWith(`.${h}`))) return 0
  return 1
}

export function isHighFrictionUrl(url: string): boolean {
  return crawlRiskScore(url) >= 2
}

export function serpHitToItem(hit: SerpHit): SerpHybridItem {
  const url = String(hit.url ?? '').trim()
  let source = String(hit.source ?? '').trim()
  if (!source) {
    try {
      source = new URL(url).hostname.replace(/^www\./i, '')
    } catch {
      source = ''
    }
  }
  return {
    title: String(hit.title || url).trim().slice(0, 200),
    url,
    source,
    excerpt: String(hit.snippet ?? '').trim().slice(0, 400),
    excerpt_source: 'manager_serp',
  }
}

export function buildSerpHitIndex(hits: SerpHit[]): Map<string, SerpHit> {
  const map = new Map<string, SerpHit>()
  for (const h of hits) {
    const url = String(h.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) continue
    map.set(normalizeUrlKey(url), h)
  }
  return map
}

export function serpItemForUrl(hits: SerpHit[] | Map<string, SerpHit>, url: string): SerpHybridItem | null {
  const index = hits instanceof Map ? hits : buildSerpHitIndex(hits)
  const hit = index.get(normalizeUrlKey(url))
  return hit ? serpHitToItem(hit) : null
}

export function partitionSeedsForHybrid(
  seeds: string[],
  hits: SerpHit[],
): { crawlSeeds: string[]; serpOnlyItems: SerpHybridItem[]; mcpSeeds: string[] } {
  const crawlSeeds: string[] = []
  const serpOnlyItems: SerpHybridItem[] = []
  const mcpSeeds: string[] = []
  const index = buildSerpHitIndex(hits)
  for (const raw of seeds) {
    const url = String(raw ?? '').trim()
    if (!/^https?:\/\//i.test(url)) continue
    const hit = index.get(normalizeUrlKey(url))
    const action =
      hit?.crawlAction ??
      (isSearchEngineResultUrl(url)
        ? 'serp_only'
        : isHighFrictionUrl(url)
          ? hit?.snippet?.trim().length
            ? 'serp_only'
            : 'mcp'
          : 'crawl')
    if (action === 'serp_only') {
      const item = serpItemForUrl(index, url)
      if (item) serpOnlyItems.push(item)
      else if (hit) serpOnlyItems.push(serpHitToItem(hit))
      continue
    }
    if (action === 'mcp') {
      mcpSeeds.push(url)
      crawlSeeds.push(url)
      continue
    }
    crawlSeeds.push(url)
  }
  return { crawlSeeds, serpOnlyItems, mcpSeeds }
}

export function parseSerpHitsFromOptions(options?: Record<string, unknown> | null): SerpHit[] {
  if (!options || typeof options !== 'object') return []
  const fromJson = Array.isArray((options as any).__serpHits) ? (options as any).__serpHits : []
  const out: SerpHit[] = []
  for (const row of fromJson) {
    if (!row || typeof row !== 'object') continue
    const url = String((row as SerpHit).url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) continue
    out.push({
      title: String((row as SerpHit).title ?? url).trim(),
      url,
      snippet: String((row as SerpHit).snippet ?? '').trim(),
      source: String((row as SerpHit).source ?? '').trim() || undefined,
      crawlRisk: Number.isFinite(Number((row as SerpHit).crawlRisk))
        ? Number((row as SerpHit).crawlRisk)
        : crawlRiskScore(url),
      relevanceScore: Number.isFinite(Number((row as SerpHit).relevanceScore))
        ? Number((row as SerpHit).relevanceScore)
        : undefined,
      publishedDate: String((row as SerpHit).publishedDate ?? '').trim() || undefined,
      crawlAction:
        (row as SerpHit).crawlAction === 'crawl' ||
        (row as SerpHit).crawlAction === 'serp_only' ||
        (row as SerpHit).crawlAction === 'mcp'
          ? (row as SerpHit).crawlAction
          : undefined,
    })
  }
  return out.slice(0, 12)
}

export function shouldSerpFallbackForUrl(
  serpHits: SerpHit[],
  url: string,
  errMsg?: string,
  emptyResult?: boolean,
): boolean {
  if (!serpHits.length) return false
  if (emptyResult) return Boolean(serpItemForUrl(serpHits, url))
  return isHttpBlockedErrorMessage(String(errMsg ?? ''))
}

export function isHttpBlockedErrorMessage(msg: string): boolean {
  const m = String(msg ?? '').toLowerCase()
  return (
    m.includes('403') ||
    m.includes('401') ||
    m.includes('429') ||
    m.includes('forbidden') ||
    m.includes('blocked') ||
    m.includes('captcha') ||
    m.includes('验证码') ||
    m.includes('拦截') ||
    m.includes('captcha_or_block')
  )
}

/** Manager SERP 混合模式：有摘要可回退时跳过多轮浏览器重试（参考 Crawlee/Firecrawl 选择性深抓） */
export function hasSerpFallbackForUrl(serpHits: SerpHit[], url: string): boolean {
  const item = serpItemForUrl(serpHits, url)
  return Boolean(item && String(item.excerpt ?? '').trim().length >= 8)
}

/** 任意一条 SERP 命中已有可用摘要（验证码 fail-fast 不必精确匹配当前 URL） */
export function hasAnySerpExcerpt(serpHits: SerpHit[]): boolean {
  return serpHits.some((h) => String(h?.snippet ?? '').trim().length >= 8)
}

export function shouldFailFastToSerp(
  url: string,
  serpHits: SerpHit[],
  options?: Record<string, unknown> | null,
  errMsg?: string,
): boolean {
  if (!Boolean(options?.__serpHybrid) || !serpHits.length) return false
  // 验证码/拦截：有任意可用 SERP 摘要即立即回退，禁止浏览器空转
  if (errMsg && isHttpBlockedErrorMessage(errMsg)) {
    return hasAnySerpExcerpt(serpHits) || hasSerpFallbackForUrl(serpHits, url)
  }
  if (!hasSerpFallbackForUrl(serpHits, url)) return false
  if (isHighFrictionUrl(url)) return true
  const action = serpHits.find((h) => normalizeUrlKey(h.url) === normalizeUrlKey(url))?.crawlAction
  return action === 'serp_only'
}
