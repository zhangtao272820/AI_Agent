import type { WebSearchHit } from './webSearchTool'
import { crawlActionForUrl, crawlRiskScore } from '../crawler/crawlSeedRisk'
import { hasConfiguredSearchBackend, isManagerWebSearchEnabled } from './webSearchTool'
import {
  searchMaxHits,
  searchMaxQueriesPerRound,
  searchMaxSeeds,
  searchMaxSeedsPerDomain
} from './managerSearchConfig'
import type { TaskClause } from '../../graph/core/routing/clauses'
import type { Step } from '#agent-shared/taskPlan'

/** 可注入 Manager SERP 摘要的执行 agent */
export const SERP_CONTEXT_AGENTS = new Set<Step['agent']>(['crawler', 'music', 'video', 'multimodal'])

const SERP_CONTEXT_MAX: Partial<Record<Step['agent'], number>> = {
  crawler: 800,
  music: 600,
  video: 600,
  multimodal: 500
}

/** 从多轮上下文中取出当前轮用户句（无正则） */
export function extractCurrentUserInput(text: string): string {
  const marker = '【当前用户输入】'
  const i = String(text ?? '').indexOf(marker)
  const raw = i >= 0 ? String(text).slice(i + marker.length) : String(text ?? '')
  return raw.replace(/\r\n/g, '\n').trim().slice(0, 240)
}

/** 媒体创作需外部参考时由 resolveNeedsWebSearchAsync + LLM 判定 */
export function inferMediaWebSearchFromText(_userText: string): boolean {
  return false
}

/**
 * 是否在本轮执行 web_search。
 * - 路由 LLM 置 needsWebSearch 且任务含 crawler 或 music/video
 * - 或 music/video 任务 + 媒体参考 LLM 判定（见 resolveNeedsWebSearchAsync）
 */
export function resolveNeedsWebSearch(input: {
  llmNeedsWebSearch?: boolean
  intent?: string
  allowedAgents?: Step['agent'][]
  userText?: string
}): { needsWebSearch: boolean; reason: string } {
  if (!isManagerWebSearchEnabled()) return { needsWebSearch: false, reason: 'disabled' }

  const intent = String(input.intent ?? '').trim()
  const agents = new Set(input.allowedAgents ?? [])
  const crawlerInRoute = intent === 'crawler' || (intent === 'multi' && agents.has('crawler'))
  const mediaInRoute =
    intent === 'music' ||
    intent === 'video' ||
    (intent === 'multi' && (agents.has('music') || agents.has('video')))

  if (input.llmNeedsWebSearch === true && (crawlerInRoute || mediaInRoute)) {
    return { needsWebSearch: true, reason: 'route_llm' }
  }

  if (mediaInRoute && inferMediaWebSearchFromText(String(input.userText ?? ''))) {
    return { needsWebSearch: true, reason: 'media_reference_llm_pending' }
  }

  return { needsWebSearch: false, reason: 'skip' }
}

export function shouldRunWebSearch(input: { needsWebSearch?: boolean }): boolean {
  return isManagerWebSearchEnabled() && input.needsWebSearch === true
}

export function shouldRouteToWebSearch(state: {
  intent?: string
  meta?: Record<string, unknown>
}): boolean {
  const meta = state.meta && typeof state.meta === 'object' ? state.meta : {}
  const webMode = meta.webExecutionMode as { mode?: string } | undefined
  if (webMode?.mode === 'gui' || webMode?.mode === 'crawl_direct') return false
  if (String(state.intent ?? meta.intent ?? '').trim() === 'gui') return false
  if (Array.isArray(meta.allowedAgents) && (meta.allowedAgents as string[]).includes('gui') && !((meta.allowedAgents as string[]).includes('crawler'))) {
    return false
  }
  return shouldRunWebSearch({ needsWebSearch: meta.needsWebSearch as boolean | undefined })
}

export function searchProviderWarning(): string | undefined {
  if (!isManagerWebSearchEnabled()) return 'MANAGER_WEB_SEARCH 已关闭'
  if (hasConfiguredSearchBackend()) return undefined
  return '未配置 SEARXNG_BASE_URL / TAVILY/SERPER Key：请设 MANAGER_WEB_SEARCH_MODE=open 并部署 SearXNG，或配置付费 API'
}

const WEB_SEARCH_CLAUSE_AGENTS = new Set(['crawler', 'music', 'video'])

/** 仅 crawler/music/video 绑定子句可作为 SERP query（禁止把 rag/db/admin 整段原话入搜） */
export function webSearchClauseTexts(clauses?: TaskClause[]): string[] {
  if (!clauses?.length) return []
  const out: string[] = []
  for (const c of clauses) {
    if (!c.agents?.some((a) => WEB_SEARCH_CLAUSE_AGENTS.has(String(a)))) continue
    const t = String(c.text ?? '').trim()
    if (t.length >= 4 && t.length <= 240) out.push(t)
  }
  return [...new Set(out)]
}

export function hasWebSearchBoundClause(clauses?: TaskClause[]): boolean {
  return webSearchClauseTexts(clauses).length > 0
}

/**
 * 检索 query：优先 crawler/media 子句；
 * 复合多子句且无公网绑定子句时返回空（禁止 fallback 整段用户原话）；
 * 无子句 / 单句任务才可用当前用户句。
 */
export function decomposeSearchQueries(userText: string, clauses?: TaskClause[]): string[] {
  const fromClauses = webSearchClauseTexts(clauses)
  if (fromClauses.length) return fromClauses.slice(0, searchMaxQueriesPerRound())
  // 多子句复合任务：无 crawler/media 子句则不入搜（天气/知识库/数据库不得整句透传）
  if (Array.isArray(clauses) && clauses.length >= 2) return []
  const base = extractCurrentUserInput(userText) || String(userText ?? '').trim()
  if (base.length >= 4) return [base.slice(0, 200)].slice(0, searchMaxQueriesPerRound())
  return []
}

export type SerpHitPayload = {
  title: string
  url: string
  snippet: string
  source?: string
  crawlRisk?: number
  relevanceScore?: number
  publishedDate?: string
  crawlAction?: 'crawl' | 'serp_only' | 'mcp'
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

function hitByUrl(hits: WebSearchHit[]): Map<string, WebSearchHit> {
  const map = new Map<string, WebSearchHit>()
  for (const h of hits) {
    const url = String(h.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) continue
    const key = normalizeUrlKey(url)
    if (!map.has(key)) map.set(key, h)
  }
  return map
}

function toSerpHitPayload(h: WebSearchHit, url: string): SerpHitPayload {
  const snippet = String(h.snippet ?? '').trim().slice(0, 400)
  let source = ''
  try {
    source = new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    source = ''
  }
  const risk = crawlRiskScore(url)
  return {
    title: String(h.title ?? url).trim().slice(0, 200),
    url,
    snippet,
    source,
    crawlRisk: risk,
    relevanceScore: Number.isFinite(Number(h.score)) ? Number(h.score) : undefined,
    publishedDate: String(h.publishedDate ?? '').trim() || undefined,
    crawlAction: crawlActionForUrl(url, snippet.length >= 8)
  }
}

/** 结构化 SERP 命中，供 Extractor serp_hybrid 消费 */
export function searchHitsToSerpPayload(hits: WebSearchHit[], max = searchMaxSeeds()): SerpHitPayload[] {
  const out: SerpHitPayload[] = []
  const seen = new Set<string>()
  for (const h of hits) {
    const url = String(h.url ?? '').trim()
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push(toSerpHitPayload(h, url))
    if (out.length >= max) break
  }
  return out
}

/** 与 seed_urls 对齐的 SERP 载荷：优先种子集合，并补齐同批检索中的旁路命中 */
export function buildSerpPayloadForCrawl(
  hits: WebSearchHit[],
  seedUrls: string[],
  max = searchMaxSeeds()
): SerpHitPayload[] {
  const byUrl = hitByUrl(hits)
  const out: SerpHitPayload[] = []
  const seen = new Set<string>()
  for (const raw of seedUrls) {
    const url = String(raw ?? '').trim()
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    const hit = byUrl.get(normalizeUrlKey(url))
    out.push(hit ? toSerpHitPayload(hit, url) : toSerpHitPayload({ title: url, url, snippet: '' }, url))
  }
  for (const h of hits) {
    if (out.length >= max) break
    const url = String(h.url ?? '').trim()
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push(toSerpHitPayload(h, url))
  }
  return out.slice(0, max)
}

export function formatSerpContextFromPayload(payload: SerpHitPayload[], maxChars = 2400): string {
  if (!payload.length) return ''
  const hits: WebSearchHit[] = payload.map((p) => ({
    title: p.title,
    url: p.url,
    snippet: p.snippet,
    score: p.relevanceScore,
    publishedDate: p.publishedDate
  }))
  return formatSerpContextForPrompt(hits, maxChars)
}

export function formatSerpContextForPrompt(hits: WebSearchHit[], maxChars = 2400): string {
  if (!hits.length) return ''
  const lines = hits.slice(0, Math.min(8, searchMaxHits())).map((h, i) => {
    const snip = String(h.snippet ?? '').trim().slice(0, 220)
    const url = String(h.url ?? '').trim()
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      /* ignore */
    }
    const dateHint = String((h as { publishedDate?: string }).publishedDate ?? '').trim()
    const titleLine = `${i + 1}. ${h.title}${host ? ` (${host})` : ''}${dateHint ? ` · ${dateHint}` : ''}`
    const urlLine = /^https?:\/\//i.test(url) ? `URL: ${url}` : ''
    return [titleLine, urlLine, snip].filter(Boolean).join('\n')
  })
  let block = lines.join('\n\n')
  if (block.length > maxChars) block = `${block.slice(0, maxChars - 1)}…`
  return block
}

function seedHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** 按 score 排序，URL 去重，同域名限条（避免种子被单一站点占满） */
export function seedUrlsFromHits(hits: WebSearchHit[], opts?: { maxTotal?: number; maxPerDomain?: number }): string[] {
  const maxTotal = Math.max(1, Number(opts?.maxTotal ?? searchMaxSeeds()))
  const maxPerDomain = Math.max(1, Number(opts?.maxPerDomain ?? searchMaxSeedsPerDomain()))
  const ranked = [...hits]
    .filter((h) => /^https?:\/\//i.test(String(h.url ?? '').trim()))
    .sort((a, b) => {
      const riskDiff = crawlRiskScore(String(a.url ?? '')) - crawlRiskScore(String(b.url ?? ''))
      if (riskDiff !== 0) return riskDiff
      return (Number(b.score ?? 0) || 0) - (Number(a.score ?? 0) || 0)
    })
  const seen = new Set<string>()
  const domainCount = new Map<string, number>()
  const urls: string[] = []
  for (const h of ranked) {
    const u = String(h.url ?? '').trim()
    if (!u || seen.has(u)) continue
    const host = seedHostname(u)
    if (host) {
      const cnt = domainCount.get(host) ?? 0
      if (cnt >= maxPerDomain) continue
      domainCount.set(host, cnt + 1)
    }
    seen.add(u)
    urls.push(u)
    if (urls.length >= maxTotal) break
  }
  return urls
}

/** 将 meta.serpContext 追加到 agent 执行 query（crawler / 媒体类） */
export function appendSerpContextToQuery(
  query: string,
  meta?: Record<string, unknown> | null,
  agent?: Step['agent']
): string {
  const q = String(query ?? '').trim()
  if (!agent || !SERP_CONTEXT_AGENTS.has(agent)) return q
  const ctx = String(meta?.serpContext ?? '').trim()
  if (!ctx) return q
  const max = SERP_CONTEXT_MAX[agent] ?? 600
  const label =
    agent === 'crawler'
      ? '联网检索摘要'
      : agent === 'music'
        ? '联网风格/参考摘要（仅供创作，勿当作最终事实来源）'
        : agent === 'video'
          ? '联网场景/视觉参考摘要（仅供分镜与氛围，勿当作最终事实来源）'
          : '联网背景摘要'
  if (q.includes('【联网') && q.includes('摘要】')) return q
  return `${q}\n\n【${label}】\n${ctx.slice(0, max)}`
}

/** 供 music/video WS 的结构化联网上下文 */
export function buildMediaWebContext(meta?: Record<string, unknown> | null): {
  summary: string
  references: Array<{ title: string; url: string; snippet: string }>
} | null {
  if (!meta || typeof meta !== 'object') return null
  const hits = Array.isArray(meta.searchHits) ? (meta.searchHits as WebSearchHit[]) : []
  const summary = String(meta.serpContext ?? '').trim().slice(0, 1200)
  const references = hits
    .slice(0, Math.min(4, searchMaxSeeds()))
    .map((h) => ({
      title: String(h.title ?? '').trim().slice(0, 200),
      url: String(h.url ?? '').trim(),
      snippet: String(h.snippet ?? '').trim().slice(0, 280)
    }))
    .filter((r) => /^https?:\/\//i.test(r.url))
  if (!summary && !references.length) return null
  return { summary, references }
}
