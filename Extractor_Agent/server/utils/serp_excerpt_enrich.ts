/**
 * 用 Manager 下发的 SERP 摘要补全抓取 items 的空 excerpt。
 */

import type { SerpHit } from './serp_hybrid'
import { serpHitToItem } from './serp_hybrid'
import { isSearchEngineResultUrl, isValidCrawlSeedUrl } from '#agent-shared/crawlUrlQuality'

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(String(url ?? '').trim())
    u.hash = ''
    return u.toString().replace(/\/+$/, '')
  } catch {
    return String(url ?? '').trim().replace(/\/+$/, '')
  }
}

export function parseSerpContextByUrl(serpContext: string): Map<string, string> {
  const map = new Map<string, string>()
  const ctx = String(serpContext ?? '').trim()
  if (!ctx) return map

  for (const block of ctx.split(/\n(?=\d+\.\s|\[\d+\]\s)/)) {
    const urlM = block.match(/URL:\s*(https?:\/\/\S+)/i)
    const url = urlM ? urlM[1]!.replace(/[)\],.]+$/, '') : ''
    if (!url) continue
    const snip = block
      .replace(/^(?:\d+\.|\[\d+\])\s*.+\n?/i, '')
      .replace(/URL:.+/i, '')
      .trim()
      .slice(0, 400)
    if (snip) map.set(normalizeUrlKey(url), snip)
  }
  return map
}

export function enrichItemsFromSerpContext<T extends Record<string, unknown>>(
  items: T[],
  serpContext?: string
): T[] {
  const ctx = String(serpContext ?? '').trim()
  if (!ctx || !items.length) return items
  const byUrl = parseSerpContextByUrl(ctx)
  if (!byUrl.size) return items

  return items.map((item) => {
    const url = String(item.url ?? '').trim()
    if (!url) return item
    const excerpt = String(item.excerpt ?? item.summary ?? '').trim()
    if (excerpt.length >= 12) return item
    const fromSerp = byUrl.get(normalizeUrlKey(url))
    if (!fromSerp) return item
    return { ...item, excerpt: fromSerp, excerpt_source: 'manager_serp' }
  })
}

export function enrichItemsFromSerpHits<T extends Record<string, unknown>>(
  items: T[],
  serpHits?: SerpHit[],
): T[] {
  const hits = Array.isArray(serpHits) ? serpHits : []
  if (!hits.length || !items.length) return items
  const byUrl = new Map<string, string>()
  for (const h of hits) {
    const snip = String(h.snippet ?? '').trim()
    if (snip.length >= 8) byUrl.set(normalizeUrlKey(h.url), snip.slice(0, 400))
  }
  if (!byUrl.size) return items
  return items.map((item) => {
    const url = String(item.url ?? '').trim()
    if (!url) return item
    const excerpt = String(item.excerpt ?? item.summary ?? '').trim()
    if (excerpt.length >= 12) return item
    const fromSerp = byUrl.get(normalizeUrlKey(url))
    if (!fromSerp) return item
    return { ...item, excerpt: fromSerp, excerpt_source: 'manager_serp' }
  })
}

/** 将 SERP 命中中尚未出现在 items 里的 URL 补入（混合抓取旁路） */
export function mergeMissingSerpItems<T extends Record<string, unknown>>(
  items: T[],
  serpHits?: SerpHit[],
): T[] {
  const hits = Array.isArray(serpHits) ? serpHits : []
  if (!hits.length) return items
  const seen = new Set(items.map((it) => normalizeUrlKey(String(it.url ?? ''))))
  const out = [...items]
  for (const h of hits) {
    const key = normalizeUrlKey(h.url)
    if (!key || seen.has(key)) continue
    if (!isValidCrawlSeedUrl(h.url) && isSearchEngineResultUrl(h.url)) continue
    const snip = String(h.snippet ?? '').trim()
    if (snip.length < 8 && !String(h.title ?? '').trim()) continue
    seen.add(key)
    out.push(serpHitToItem(h) as T)
  }
  return out
}

export function enrichItemsFromManagerSearchBundle<T extends Record<string, unknown>>(
  items: T[],
  bundle?: {
    serpContext?: string
    serpHits?: SerpHit[]
    tavilyAnswer?: string
  },
): T[] {
  let out = enrichItemsFromSerpContext(items, bundle?.serpContext)
  out = enrichItemsFromSerpHits(out, bundle?.serpHits)
  out = mergeMissingSerpItems(out, bundle?.serpHits)
  out = out.filter((it) => {
    const url = String(it.url ?? '').trim()
    if (!url) return true
    return !isSearchEngineResultUrl(url)
  })
  const tavily = String(bundle?.tavilyAnswer ?? '').trim()
  if (tavily.length >= 40 && out.length === 0) {
    out.push({
      title: '联网检索综合摘要',
      url: '',
      source: 'manager_search',
      excerpt: tavily.slice(0, 600),
      excerpt_source: 'tavily_answer',
    } as T)
  }
  return out
}
