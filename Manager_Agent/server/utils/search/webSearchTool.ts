/**
 * Manager 轻量联网：统一 SERP 结果结构，支持 Tavily / Serper / DuckDuckGo。
 */

import {
  searchMaxHits,
  searchMaxQueriesPerRound,
  searchResultsPerQuery
} from './managerSearchConfig'

export type WebSearchHit = {
  title: string
  url: string
  snippet: string
  score?: number
  publishedDate?: string
}

export type WebSearchMode = 'general' | 'news'

export type WebSearchBatchResult = {
  hits: WebSearchHit[]
  errors: string[]
  tavilyAnswer?: string
}

export type WebSearchProvider = 'tavily' | 'serper' | 'searxng' | 'duckduckgo'

export { isSearxngSearchConfigured, isSelfHostedWebSearch } from './managerWebSearchMode'
import { isSearxngSearchConfigured, isSelfHostedWebSearch } from './managerWebSearchMode'
import { isWebSearchEnabled } from './managerWebSearchMode'

export function resolveSearxngBaseUrl(): string {
  const raw = String(process.env.SEARXNG_BASE_URL ?? 'http://searxng:8080').trim()
  return raw.replace(/\/+$/, '')
}

export function hasConfiguredSearchBackend(): boolean {
  return hasPaidSearchApiKey() || isSearxngSearchConfigured()
}

export function isManagerWebSearchEnabled(): boolean {
  return isWebSearchEnabled()
}

export function hasPaidSearchApiKey(): boolean {
  return (
    String(process.env.TAVILY_API_KEY ?? '').trim().length > 0 ||
    String(process.env.SERPER_API_KEY ?? '').trim().length > 0
  )
}

export function resolveWebSearchProvider(): WebSearchProvider {
  const p = String(process.env.WEB_SEARCH_PROVIDER ?? '').trim().toLowerCase()
  if (p === 'tavily' || p === 'serper' || p === 'searxng' || p === 'duckduckgo' || p === 'ddg') {
    return p === 'ddg' ? 'duckduckgo' : (p as WebSearchProvider)
  }
  if (isSearxngSearchConfigured()) return 'searxng'
  const hasTavily = String(process.env.TAVILY_API_KEY ?? '').trim().length > 0
  const hasSerper = String(process.env.SERPER_API_KEY ?? '').trim().length > 0
  if (hasTavily) return 'tavily'
  if (hasSerper) return 'serper'
  return 'duckduckgo'
}

/** 显式指定 tavily/serper 时默认不回退 duckduckgo（国内 Docker 常 fetch failed） */
export function isWebSearchDdgFallbackEnabled(): boolean {
  const v = String(process.env.WEB_SEARCH_ALLOW_DDG_FALLBACK ?? '0').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

/** 默认 basic；自建 SearXNG 时等同 advanced 预算（更多结果，无 Tavily 计费） */
export function tavilySearchDepth(): 'basic' | 'advanced' {
  const v = String(process.env.MANAGER_SEARCH_DEPTH ?? '').trim()
  if (v === 'advanced') return 'advanced'
  if (v === 'basic') return 'basic'
  return isSelfHostedWebSearch() ? 'advanced' : 'basic'
}
export function searchIncludeAnswer(): boolean {
  return String(process.env.MANAGER_SEARCH_INCLUDE_ANSWER ?? '0').trim() === '1'
}

/** 联网模式：默认 general（省额度）；news 仅当显式 MANAGER_SEARCH_NEWS_MODE=1 */
export function resolveWebSearchMode(_userText?: string): WebSearchMode {
  return String(process.env.MANAGER_SEARCH_NEWS_MODE ?? '0').trim() === '1' ? 'news' : 'general'
}

/** 搜索失败时的 provider 尝试顺序（主 provider 在前） */
export function webSearchProviderFallbackChain(primary?: WebSearchProvider): WebSearchProvider[] {
  const main = primary ?? resolveWebSearchProvider()
  if (main === 'duckduckgo') return ['duckduckgo']
  if (main === 'searxng') {
    const chain: WebSearchProvider[] = ['searxng']
    if (String(process.env.TAVILY_API_KEY ?? '').trim()) chain.push('tavily')
    if (String(process.env.SERPER_API_KEY ?? '').trim()) chain.push('serper')
    if (isWebSearchDdgFallbackEnabled()) chain.push('duckduckgo')
    return [...new Set(chain)]
  }
  const hasPaid = hasPaidSearchApiKey()
  if (!hasPaid) return isWebSearchDdgFallbackEnabled() ? ['duckduckgo'] : [main]
  const chain: WebSearchProvider[] = [main]
  if (main !== 'tavily' && String(process.env.TAVILY_API_KEY ?? '').trim()) chain.push('tavily')
  if (main !== 'serper' && String(process.env.SERPER_API_KEY ?? '').trim()) chain.push('serper')
  if (isSearxngSearchConfigured() && main !== 'searxng') chain.push('searxng')
  if (isWebSearchDdgFallbackEnabled()) chain.push('duckduckgo')
  return [...new Set(chain)]
}

function stripHtml(s: string): string {
  return String(s ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(s: string, max: number): string {
  const t = String(s ?? '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function normalizeUrl(url: string): string | null {
  const u = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(u)) return null
  try {
    const parsed = new URL(u)
    if (!parsed.hostname || parsed.hostname === 'localhost') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function dedupeHits(hits: WebSearchHit[], cap: number): WebSearchHit[] {
  const seen = new Set<string>()
  const out: WebSearchHit[] = []
  for (const h of hits) {
    const url = normalizeUrl(h.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({
      title: truncate(stripHtml(h.title), 200),
      url,
      snippet: truncate(stripHtml(h.snippet), 400),
      score: h.score,
      ...(String((h as WebSearchHit).publishedDate ?? '').trim()
        ? { publishedDate: String((h as WebSearchHit).publishedDate).trim() }
        : {})
    })
    if (out.length >= cap) break
  }
  return out
}

function paidSearchFetchTimeoutMs(): number {
  return Math.max(8_000, Number(process.env.WEB_SEARCH_PAID_TIMEOUT_MS ?? process.env.SEARXNG_TIMEOUT_MS ?? 25_000))
}

async function searchTavily(
  query: string,
  maxResults: number,
  mode: WebSearchMode = 'general'
): Promise<{ hits: WebSearchHit[]; answer?: string }> {
  const key = String(process.env.TAVILY_API_KEY ?? '').trim()
  if (!key) throw new Error('TAVILY_API_KEY 未配置')
  const body: Record<string, unknown> = {
    api_key: key,
    query,
    search_depth: tavilySearchDepth(),
    max_results: Math.min(10, maxResults),
    include_answer: searchIncludeAnswer()
  }
  if (mode === 'news') body.topic = 'news'
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(paidSearchFetchTimeoutMs())
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Tavily search failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    answer?: string
    results?: Array<{ title?: string; url?: string; content?: string; score?: number; published_date?: string }>
  }
  const hits = (data.results ?? []).map((r) => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    snippet: String(r.content ?? ''),
    score: typeof r.score === 'number' ? r.score : undefined,
    publishedDate: String(r.published_date ?? '').trim() || undefined
  }))
  const answer = String(data.answer ?? '').trim() || undefined
  return { hits, answer }
}

async function searchSearxng(query: string, maxResults: number, mode: WebSearchMode = 'general'): Promise<WebSearchHit[]> {
  const base = resolveSearxngBaseUrl()
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    language: String(process.env.SEARXNG_LANGUAGE ?? 'zh-CN').trim() || 'zh-CN'
  })
  const categories = String(process.env.SEARXNG_CATEGORIES ?? (mode === 'news' ? 'news' : 'general')).trim()
  if (categories) params.set('categories', categories)

  const res = await fetch(`${base}/search?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ManagerAgent/1.0 (SearXNG client)'
    },
    signal: AbortSignal.timeout(Math.max(8_000, Number(process.env.SEARXNG_TIMEOUT_MS ?? 20_000)))
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`SearXNG search failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string; engine?: string; score?: number; publishedDate?: string }>
    unresponsive_engines?: Array<[string, string]>
    error?: string
  }
  const unresponsive = (data.unresponsive_engines ?? [])
    .map(([engine, reason]) => `${engine}:${reason}`)
    .join(', ')
  if (!(data.results ?? []).length && unresponsive) {
    throw new Error(`SearXNG 无结果（引擎不可用: ${unresponsive.slice(0, 240)}）`)
  }
  return (data.results ?? []).slice(0, maxResults).map((r, i) => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    snippet: String(r.content ?? ''),
    score: typeof r.score === 'number' ? r.score : 1 / (1 + i),
    publishedDate: String(r.publishedDate ?? '').trim() || undefined
  }))
}

async function searchSerper(query: string, maxResults: number): Promise<WebSearchHit[]> {
  const key = String(process.env.SERPER_API_KEY ?? '').trim()
  if (!key) throw new Error('SERPER_API_KEY 未配置')
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': key
    },
    body: JSON.stringify({ q: query, num: Math.min(10, maxResults) }),
    signal: AbortSignal.timeout(paidSearchFetchTimeoutMs())
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Serper search failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string; position?: number; date?: string }>
  }
  return (data.organic ?? []).map((r, i) => ({
    title: String(r.title ?? ''),
    url: String(r.link ?? ''),
    snippet: String(r.snippet ?? ''),
    score: typeof r.position === 'number' ? 1 / (1 + r.position) : 1 / (1 + i),
    publishedDate: String(r.date ?? '').trim() || undefined
  }))
}

async function searchSerperNews(query: string, maxResults: number): Promise<WebSearchHit[]> {
  const key = String(process.env.SERPER_API_KEY ?? '').trim()
  if (!key) throw new Error('SERPER_API_KEY 未配置')
  const res = await fetch('https://google.serper.dev/news', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': key
    },
    body: JSON.stringify({ q: query, num: Math.min(10, maxResults) }),
    signal: AbortSignal.timeout(paidSearchFetchTimeoutMs())
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Serper news failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    news?: Array<{ title?: string; link?: string; snippet?: string; date?: string; source?: string }>
  }
  return (data.news ?? []).map((r, i) => ({
    title: String(r.title ?? ''),
    url: String(r.link ?? ''),
    snippet: [String(r.source ?? '').trim(), String(r.snippet ?? '').trim()].filter(Boolean).join(' · '),
    score: 1 / (1 + i),
    publishedDate: String(r.date ?? '').trim() || undefined
  }))
}

/** DuckDuckGo Instant Answer API（无 Key；仅相关主题/百科类，不能替代 Tavily） */
async function searchDuckDuckGoInstant(query: string, maxResults: number): Promise<WebSearchHit[]> {
  const q = encodeURIComponent(query)
  const res = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; ManagerAgent/1.0)' },
    signal: AbortSignal.timeout(12_000)
  })
  if (!res.ok) throw new Error(`DuckDuckGo instant API failed: ${res.status}`)
  const data = (await res.json()) as {
    Heading?: string
    AbstractText?: string
    AbstractURL?: string
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>
  }
  const hits: WebSearchHit[] = []
  const absUrl = normalizeUrl(String(data.AbstractURL ?? ''))
  if (absUrl && data.AbstractText) {
    hits.push({
      title: String(data.Heading || query),
      url: absUrl,
      snippet: String(data.AbstractText ?? '')
    })
  }
  const walk = (topics: typeof data.RelatedTopics) => {
    for (const item of topics ?? []) {
      if (hits.length >= maxResults) return
      if (item.Topics?.length) {
        walk(item.Topics)
        continue
      }
      const url = normalizeUrl(String(item.FirstURL ?? ''))
      if (!url) continue
      hits.push({ title: stripHtml(String(item.Text ?? '').split(' - ')[0] ?? ''), url, snippet: stripHtml(String(item.Text ?? '')) })
    }
  }
  walk(data.RelatedTopics)
  return hits
}

/** DuckDuckGo HTML 轻量解析（无 API Key；易被墙/限流，仅作最后兜底） */
async function searchDuckDuckGoHtml(query: string, maxResults: number): Promise<WebSearchHit[]> {
  const q = encodeURIComponent(query)
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ManagerAgent/1.0)',
      Accept: 'text/html'
    },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`DuckDuckGo HTML search failed: ${res.status}`)
  const html = await res.text()
  const hits: WebSearchHit[] = []
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && hits.length < maxResults) {
    let url = String(m[1] ?? '').trim()
    if (url.includes('uddg=')) {
      try {
        const u = new URL(url, 'https://duckduckgo.com')
        const decoded = u.searchParams.get('uddg')
        if (decoded) url = decodeURIComponent(decoded)
      } catch {
        /* keep */
      }
    }
    hits.push({
      title: stripHtml(m[2] ?? ''),
      url,
      snippet: stripHtml(m[3] ?? '')
    })
  }
  return hits
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<WebSearchHit[]> {
  let lastErr: unknown = null
  for (const fn of [searchDuckDuckGoInstant, searchDuckDuckGoHtml]) {
    try {
      const hits = await fn(query, maxResults)
      if (hits.length) return hits
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(`DuckDuckGo 无可用结果${lastErr ? `：${String((lastErr as Error).message || lastErr)}` : ''}`)
}

export async function webSearchToolSearch(
  queries: string[],
  opts?: { provider?: WebSearchProvider; maxResultsPerQuery?: number; maxTotal?: number }
): Promise<WebSearchHit[]> {
  const r = await webSearchToolSearchDetailed(queries, opts)
  return r.hits
}

export async function webSearchToolSearchDetailed(
  queries: string[],
  opts?: { provider?: WebSearchProvider; maxResultsPerQuery?: number; maxTotal?: number; mode?: WebSearchMode; userText?: string }
): Promise<WebSearchBatchResult> {
  if (!isManagerWebSearchEnabled()) return { hits: [], errors: [] }
  const provider = opts?.provider ?? resolveWebSearchProvider()
  const mode = opts?.mode ?? resolveWebSearchMode(String(opts?.userText ?? queries[0] ?? ''))
  const perQ = Math.min(8, Math.max(1, Number(opts?.maxResultsPerQuery ?? searchResultsPerQuery())))
  const maxTotal = Math.min(24, Math.max(perQ, Number(opts?.maxTotal ?? searchMaxHits())))
  const qs = [...new Set(queries.map((q) => String(q ?? '').trim()).filter((q) => q.length >= 2))].slice(
    0,
    searchMaxQueriesPerRound()
  )
  if (!qs.length) return { hits: [], errors: [] }

  const all: WebSearchHit[] = []
  const errors: string[] = []
  let tavilyAnswer: string | undefined
  for (const query of qs) {
    try {
      if (provider === 'serper') {
        const batch = mode === 'news' ? await searchSerperNews(query, perQ) : await searchSerper(query, perQ)
        all.push(...batch)
      } else if (provider === 'searxng') {
        all.push(...(await searchSearxng(query, perQ, mode)))
      } else if (provider === 'duckduckgo') {
        all.push(...(await searchDuckDuckGo(query, perQ)))
      } else {
        const tavily = await searchTavily(query, perQ, mode)
        all.push(...tavily.hits)
        if (tavily.answer && !tavilyAnswer) tavilyAnswer = tavily.answer
      }
    } catch (e) {
      const msg = `${provider}「${query.slice(0, 40)}」: ${String((e as Error)?.message || e)}`
      errors.push(msg)
    }
    if (all.length >= maxTotal) break
  }
  return { hits: dedupeHits(all, maxTotal), errors, tavilyAnswer }
}
