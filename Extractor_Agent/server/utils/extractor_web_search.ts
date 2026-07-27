/**
 * Extractor 独立 UI / 直连：联网搜索 → seed_urls / serp_hits（与 Manager manager_task_json 同契约）。
 * 已知站点（豆瓣/知乎榜等）优先官方种子，禁止把「爬虫教程」SERP 当成目标页。
 */

import { filterCrawlSeedUrls, isLowValueTutorialSeedUrl, isValidCrawlSeedUrl } from '#agent-shared/crawlUrlQuality'
import { inferStructuralTaskPlan, seedUrlMatchesTargetSite } from '../core/plan/structural'
import { getCapabilityProfile } from '../services/capabilityRegistry'

export type ExtractorSerpHit = {
  title: string
  url: string
  snippet: string
  crawlAction?: 'crawl' | 'serp_only' | 'mcp'
}

export type ExtractorWebSearchHit = {
  title: string
  url: string
  snippet: string
}

function parseEnvBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]
  if (v == null || String(v).trim() === '') return fallback
  return /^(1|true|yes|on)$/i.test(String(v).trim())
}

export function isExtractorWebSearchEnabled(): boolean {
  return parseEnvBool('EXTRACTOR_WEB_SEARCH', true)
}

export function resolveExtractorSearxngBaseUrl(): string {
  return String(process.env.SEARXNG_BASE_URL ?? process.env.EXTRACTOR_SEARXNG_BASE_URL ?? 'http://searxng:8080')
    .trim()
    .replace(/\/+$/, '')
}

function maxSeeds(): number {
  const n = Number(process.env.EXTRACTOR_WEB_SEARCH_MAX_SEEDS ?? 6)
  return Number.isFinite(n) ? Math.max(1, Math.min(12, Math.floor(n))) : 6
}

async function searchSearxng(query: string, maxResults: number): Promise<ExtractorWebSearchHit[]> {
  const base = resolveExtractorSearxngBaseUrl()
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    language: String(process.env.SEARXNG_LANGUAGE ?? 'zh-CN').trim() || 'zh-CN',
    categories: String(process.env.SEARXNG_CATEGORIES ?? 'general').trim() || 'general',
  })
  const res = await fetch(`${base}/search?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ExtractorAgent/1.0 (SearXNG client)',
    },
    signal: AbortSignal.timeout(Math.max(8_000, Number(process.env.SEARXNG_TIMEOUT_MS ?? 20_000))),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`SearXNG failed: ${res.status} ${text.slice(0, 160)}`)
  }
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>
  }
  return (data.results ?? []).slice(0, maxResults).map((r) => ({
    title: String(r.title ?? '').trim(),
    url: String(r.url ?? '').trim(),
    snippet: String(r.content ?? '').trim(),
  }))
}

async function searchTavily(query: string, maxResults: number): Promise<ExtractorWebSearchHit[]> {
  const key = String(process.env.TAVILY_API_KEY ?? '').trim()
  if (!key) throw new Error('TAVILY_API_KEY 未配置')
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: 'basic',
      max_results: Math.min(10, maxResults),
      include_answer: false,
    }),
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Tavily failed: ${res.status} ${text.slice(0, 160)}`)
  }
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>
  }
  return (data.results ?? []).slice(0, maxResults).map((r) => ({
    title: String(r.title ?? '').trim(),
    url: String(r.url ?? '').trim(),
    snippet: String(r.content ?? '').trim(),
  }))
}

async function searchSerper(query: string, maxResults: number): Promise<ExtractorWebSearchHit[]> {
  const key = String(process.env.SERPER_API_KEY ?? '').trim()
  if (!key) throw new Error('SERPER_API_KEY 未配置')
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({ q: query, num: Math.min(10, maxResults) }),
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Serper failed: ${res.status} ${text.slice(0, 160)}`)
  }
  const data = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>
  }
  return (data.organic ?? []).slice(0, maxResults).map((r) => ({
    title: String(r.title ?? '').trim(),
    url: String(r.link ?? '').trim(),
    snippet: String(r.snippet ?? '').trim(),
  }))
}

function dedupeHits(hits: ExtractorWebSearchHit[], max: number): ExtractorWebSearchHit[] {
  const seen = new Set<string>()
  const out: ExtractorWebSearchHit[] = []
  for (const h of hits) {
    const url = String(h.url ?? '').trim()
    if (!isValidCrawlSeedUrl(url)) continue
    const key = url.replace(/\/$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ title: h.title || url, url, snippet: h.snippet || '' })
    if (out.length >= max) break
  }
  return out
}

/** 已知目标站优先；剔除教程站；限制条数避免 MCP 队列拖死 */
export function rankExtractorSerpHitsForTask(
  task: string,
  hits: ExtractorWebSearchHit[],
  max = maxSeeds()
): ExtractorWebSearchHit[] {
  const structural = inferStructuralTaskPlan(task)
  const cleaned = hits.filter((h) => isValidCrawlSeedUrl(h.url) && !isLowValueTutorialSeedUrl(h.url))
  const preferred =
    structural.targetSite !== 'generic' && structural.confidence >= 0.5
      ? cleaned.filter((h) => seedUrlMatchesTargetSite(h.url, structural.targetSite))
      : []
  const ranked = preferred.length ? [...preferred, ...cleaned.filter((h) => !preferred.includes(h))] : cleaned
  return ranked.slice(0, Math.max(1, Math.min(max, 4)))
}

export async function runExtractorWebSearch(query: string): Promise<{
  hits: ExtractorWebSearchHit[]
  provider: string
  error?: string
}> {
  if (!isExtractorWebSearchEnabled()) return { hits: [], provider: 'off' }
  const q = String(query ?? '').trim()
  if (q.length < 2) return { hits: [], provider: 'none', error: 'empty_query' }
  const max = maxSeeds()
  const providers: Array<{ name: string; run: () => Promise<ExtractorWebSearchHit[]> }> = [
    { name: 'searxng', run: () => searchSearxng(q, Math.max(max, 10)) },
  ]
  if (String(process.env.TAVILY_API_KEY ?? '').trim()) {
    providers.push({ name: 'tavily', run: () => searchTavily(q, Math.max(max, 10)) })
  }
  if (String(process.env.SERPER_API_KEY ?? '').trim()) {
    providers.push({ name: 'serper', run: () => searchSerper(q, Math.max(max, 10)) })
  }

  const errors: string[] = []
  for (const p of providers) {
    try {
      const raw = await p.run()
      const hits = rankExtractorSerpHitsForTask(q, dedupeHits(raw, max * 2), max)
      if (hits.length) return { hits, provider: p.name }
      errors.push(`${p.name}:empty_after_filter`)
    } catch (e) {
      errors.push(`${p.name}:${String((e as Error)?.message || e).slice(0, 120)}`)
    }
  }
  return { hits: [], provider: 'none', error: errors.join(' | ') || 'no_hits' }
}

export function formatExtractorSerpContext(hits: ExtractorWebSearchHit[], maxChars = 2400): string {
  const lines = hits.slice(0, maxSeeds()).map((h, i) => {
    const snip = String(h.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 220)
    return `${i + 1}. ${String(h.title || h.url).trim()}\nURL: ${h.url}\n${snip}`
  })
  let out = lines.join('\n\n')
  if (out.length > maxChars) out = out.slice(0, maxChars)
  return out
}

export function buildExtractorUiManagerTaskJson(input: {
  task: string
  hits: ExtractorWebSearchHit[]
  preferredChannel?: 'http' | 'browser' | 'mcp'
  hintFields?: string[]
}): string {
  const hits = rankExtractorSerpHitsForTask(input.task, input.hits)
  const seed_urls = filterCrawlSeedUrls(
    hits.map((h) => h.url),
    maxSeeds()
  )
  const serp_hits: ExtractorSerpHit[] = hits
    .filter((h) => seed_urls.includes(h.url))
    .map((h) => ({
      title: h.title || h.url,
      url: h.url,
      snippet: h.snippet || '',
      crawlAction: 'crawl' as const,
    }))
  const payload = {
    source: 'extractor_ui',
    refined_task: String(input.task ?? '').trim().slice(0, 1200),
    seed_urls,
    serp_hits,
    serp_context: formatExtractorSerpContext(hits),
    crawl_strategy: 'crawl_seeds',
    hint_fields: input.hintFields?.length ? input.hintFields : ['title', 'url', 'excerpt', 'source'],
    preferred_channel: input.preferredChannel || 'http',
    open_web_discovery: false,
  }
  return JSON.stringify(payload)
}

/** 已知榜单/站点：直接官方种子，跳过泛搜索（避免 CSDN 教程拖死 Firecrawl） */
export function buildSiteLockedManagerTaskJson(task: string): {
  json: string
  site: string
  seeds: string[]
} | null {
  const structural = inferStructuralTaskPlan(task)
  if (structural.targetSite === 'generic' || structural.confidence < 0.72) return null
  const prof = getCapabilityProfile(structural.targetSite as any, structural.contentType as any)
  const seeds = filterCrawlSeedUrls(prof?.defaultSeedUrls ?? [], 3)
  if (!seeds.length) return null
  const channel = (prof?.preferChannel === 'browser' || prof?.preferChannel === 'mcp' || prof?.preferChannel === 'http'
    ? prof.preferChannel
    : 'http') as 'http' | 'browser' | 'mcp'
  const payload = {
    source: 'extractor_ui',
    refined_task: String(task ?? '').trim().slice(0, 1200),
    seed_urls: seeds,
    crawl_strategy: 'crawl_seeds',
    hint_fields: structural.fields?.length ? structural.fields : ['title', 'url', 'rank'],
    preferred_channel: channel,
    open_web_discovery: false,
  }
  return { json: JSON.stringify(payload), site: structural.targetSite, seeds }
}

/**
 * 独立 UI 联网引导：站点锁 > SERP（已过滤）> 空。
 * 保证「找页」找的是目标站，而不是爬虫教程。
 */
export async function resolveExtractorUiNetworkBootstrap(task: string): Promise<{
  managerJson?: string
  mode: 'site_lock' | 'serp' | 'none'
  detail: string
}> {
  const locked = buildSiteLockedManagerTaskJson(task)
  if (locked) {
    return {
      managerJson: locked.json,
      mode: 'site_lock',
      detail: `已锁定站点 ${locked.site}，官方种子 ${locked.seeds.length} 个（跳过泛搜索）`,
    }
  }
  if (!isExtractorWebSearchEnabled()) {
    return { mode: 'none', detail: 'EXTRACTOR_WEB_SEARCH=0' }
  }
  const search = await runExtractorWebSearch(task)
  if (!search.hits.length) {
    return { mode: 'none', detail: search.error || 'serp_empty' }
  }
  return {
    managerJson: buildExtractorUiManagerTaskJson({ task, hits: search.hits }),
    mode: 'serp',
    detail: `${search.provider} 命中 ${search.hits.length} 条有效种子`,
  }
}

/** 已有 Manager 种子时不重复搜索；source=manager 的任务包也尊重总管编排（不覆盖） */
export function managerTaskAlreadyHasSeeds(managerRaw?: string | null): boolean {
  const raw = String(managerRaw ?? '').trim()
  if (!raw) return false
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (String(o.source ?? '').trim() === 'manager') return true
    const seeds = Array.isArray(o.seed_urls) ? o.seed_urls : []
    const hits = Array.isArray(o.serp_hits) ? o.serp_hits : []
    if (seeds.some((u) => /^https?:\/\//i.test(String(u ?? '')))) return true
    if (hits.some((h) => /^https?:\/\//i.test(String((h as { url?: string })?.url ?? '')))) return true
    if (String(o.serp_context ?? '').trim().length >= 40) return true
  } catch {
    return false
  }
  return false
}

export function isNetworkRequested(options?: Record<string, unknown> | null, explicit?: boolean): boolean {
  if (explicit === true) return true
  if (explicit === false) return false
  if (!options || typeof options !== 'object') return true
  if (options.network === false || options.open_network === false) return false
  if (options.network === true || options.open_network === true) return true
  return true
}
