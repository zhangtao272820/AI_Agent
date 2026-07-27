/**
 * 入站采集任务清洗：兼容总管/规划器口吻，还原为可独立执行的抓取任务。
 */

import type { CrawlerAgentOptions } from '../services/crawlerAgentTypes'
import { getExtractorAgentEnv } from './extractor_agent_env'
import { filterCrawlSeedUrls } from '#agent-shared/crawlUrlQuality'

const CRAWLER_PREFIXES = [
  '从互联网抓取相关数据：',
  '从互联网抓取相关数据:',
  '从互联网抓取相关信息：',
  '从互联网抓取相关信息:',
  '从互联网抓取相关内容：',
  '从互联网抓取相关内容:',
  '从互联网抓取：',
  '从互联网抓取:',
  '从网页抓取：',
  '从网页抓取:',
  '抓取互联网：',
  '抓取互联网:',
  '爬取互联网：',
  '爬取互联网:',
  '联网抓取：',
  '联网抓取:',
  '联网爬取：',
  '联网爬取:',
  '进行开放式发现搜索：',
  '进行开放式发现搜索:',
] as const

const PLANNER_BLOCK_TAGS = ['约束', '上下文', '上游', '步骤', '总管'] as const

const AGENT_LINE_PREFIXES = ['rag:', 'rag：', 'db:', 'db：', 'crawler:', 'crawler：', 'admin:', 'admin：'] as const

function stripCrawlerPrefix(q: string): string {
  let s = q.trim()
  for (const p of CRAWLER_PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length).trim()
      break
    }
  }
  return s
}

function stripTrailingReport(q: string): string {
  let s = q.trim()
  if (s.endsWith('，并生成报告')) s = s.slice(0, -'，并生成报告'.length).trim()
  else if (s.endsWith(',并生成报告')) s = s.slice(0, -',并生成报告'.length).trim()
  else if (s.endsWith('并生成报告')) s = s.slice(0, -'并生成报告'.length).replace(/[，,]\s*$/, '').trim()
  return s
}

function stripPlannerBlock(q: string): string {
  let cut = q.length
  for (const tag of PLANNER_BLOCK_TAGS) {
    for (const lead of ['\n\n[', '\n[']) {
      const marker = `${lead}${tag}`
      const i = q.indexOf(marker)
      if (i >= 0 && i < cut) cut = i
    }
  }
  return cut < q.length ? q.slice(0, cut).trim() : q
}

export type ManagerTaskHints = {
  source?: string
  refined_task?: string
  hint_fields?: string[]
  preferred_channel?: 'http' | 'browser' | 'mcp'
  must_filters?: string[]
  open_web_discovery?: boolean
  seed_urls?: string[]
  serp_context?: string
  serp_hits?: Array<{
    title?: string
    url?: string
    snippet?: string
    source?: string
    crawlRisk?: number
    relevanceScore?: number
    publishedDate?: string
    crawlAction?: 'crawl' | 'serp_only' | 'mcp'
  }>
  search_context?: {
    mode?: 'general' | 'news'
    sub_queries?: string[]
    expected_evidence?: string[]
    tavily_answer?: string
    verify_note?: string
  }
  crawl_strategy?: 'serp_only' | 'crawl_seeds' | 'open_discovery'
}

export function sanitizeIncomingTask(raw: string): string {
  const max = getExtractorAgentEnv().taskMaxChars
  let t = String(raw ?? '').replace(/\r\n/g, '\n').trim()
  if (!t) return ''

  t = stripPlannerBlock(t)
  t = stripCrawlerPrefix(t)
  t = stripTrailingReport(t)

  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !AGENT_LINE_PREFIXES.some((p) => l.toLowerCase().startsWith(p.toLowerCase())))
  t = lines.join('\n').trim() || String(raw ?? '').trim()

  t = t.replace(/\s+/g, ' ').trim()
  return t.slice(0, max) || String(raw ?? '').trim().slice(0, max)
}

export function parseManagerTaskJson(raw?: string | Record<string, unknown> | null): ManagerTaskHints | null {
  let obj: Record<string, unknown> | null = null
  if (raw && typeof raw === 'object') obj = raw
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      obj = JSON.parse(raw.trim()) as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object') return null

  const refined = String(obj.refined_task ?? obj.refined_question ?? obj.query ?? '').trim()
  const hintFields = Array.isArray(obj.hint_fields)
    ? obj.hint_fields.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 12)
    : []
  const channel = String(obj.preferred_channel ?? '').trim().toLowerCase()
  const preferred_channel =
    channel === 'http' || channel === 'browser' || channel === 'mcp' ? (channel as ManagerTaskHints['preferred_channel']) : undefined
  const must_filters = Array.isArray(obj.must_filters)
    ? obj.must_filters.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
    : undefined
  const seed_urls = Array.isArray(obj.seed_urls)
    ? obj.seed_urls.map((x) => String(x ?? '').trim()).filter((u) => u.startsWith('http://') || u.startsWith('https://')).slice(0, 12)
    : undefined
  const serp_context = String(obj.serp_context ?? '').trim().slice(0, 2400) || undefined
  const serp_hits = Array.isArray(obj.serp_hits)
    ? obj.serp_hits
        .map((row) => {
          if (!row || typeof row !== 'object') return null
          const url = String((row as { url?: string }).url ?? '').trim()
          if (!url.startsWith('http://') && !url.startsWith('https://')) return null
          const crawlAction = String((row as { crawlAction?: string }).crawlAction ?? '').trim()
          return {
            title: String((row as { title?: string }).title ?? url).trim(),
            url,
            snippet: String((row as { snippet?: string }).snippet ?? '').trim(),
            source: String((row as { source?: string }).source ?? '').trim() || undefined,
            crawlRisk: Number.isFinite(Number((row as { crawlRisk?: number }).crawlRisk))
              ? Number((row as { crawlRisk?: number }).crawlRisk)
              : undefined,
            relevanceScore: Number.isFinite(Number((row as { relevanceScore?: number }).relevanceScore))
              ? Number((row as { relevanceScore?: number }).relevanceScore)
              : undefined,
            publishedDate: String((row as { publishedDate?: string }).publishedDate ?? '').trim() || undefined,
            crawlAction:
              crawlAction === 'crawl' || crawlAction === 'serp_only' || crawlAction === 'mcp'
                ? (crawlAction as 'crawl' | 'serp_only' | 'mcp')
                : undefined,
          }
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
        .slice(0, 12)
    : undefined
  const search_context =
    obj.search_context && typeof obj.search_context === 'object'
      ? (obj.search_context as ManagerTaskHints['search_context'])
      : undefined
  const crawl_strategy =
    obj.crawl_strategy === 'serp_only' ||
    obj.crawl_strategy === 'crawl_seeds' ||
    obj.crawl_strategy === 'open_discovery'
      ? obj.crawl_strategy
      : undefined
  const source = String(obj.source ?? '').trim() || undefined
  const open_web_discovery =
    obj.open_web_discovery === true ||
    (String(obj.source ?? '') === 'manager' &&
      !seed_urls?.length &&
      hintFields.some((f) => f === 'excerpt' || f === 'source'))

  if (!refined && !hintFields.length && !preferred_channel && !seed_urls?.length && !open_web_discovery) return null
  return {
    ...(source ? { source } : {}),
    ...(refined ? { refined_task: refined } : {}),
    ...(hintFields.length ? { hint_fields: hintFields } : {}),
    ...(preferred_channel ? { preferred_channel } : {}),
    ...(must_filters?.length ? { must_filters } : {}),
    ...(open_web_discovery ? { open_web_discovery: true } : {}),
    ...(seed_urls?.length ? { seed_urls } : {}),
    ...(serp_context ? { serp_context } : {}),
    ...(serp_hits?.length ? { serp_hits } : {}),
    ...(search_context ? { search_context } : {}),
    ...(crawl_strategy ? { crawl_strategy } : {})
  }
}

export function applyManagerTaskHints(
  task: string,
  managerTask?: string | Record<string, unknown> | null,
): { task: string; options: Partial<CrawlerAgentOptions> } {
  const hints = parseManagerTaskJson(managerTask)
  if (!hints) return { task, options: {} }

  const nextTask = hints.refined_task ? sanitizeIncomingTask(hints.refined_task) : task
  const options: Partial<CrawlerAgentOptions> = {}
  if (hints.preferred_channel === 'browser') options.useBrowser = true
  if (hints.preferred_channel === 'mcp') (options as any).__preferMcp = true
  if (hints.preferred_channel) (options as any).preferred_channel = hints.preferred_channel
  if (hints.hint_fields?.length) {
    ;(options as any).hint_fields = hints.hint_fields
  }
  if (hints.must_filters?.length) {
    ;(options as any).must_filters = hints.must_filters
  }
  if (hints.seed_urls?.length) {
    const seeds = filterCrawlSeedUrls(hints.seed_urls, 12)
    ;(options as any).__managerSeedUrls = seeds
    ;(options as any).__seedFirstMode = true
    ;(options as any).__openWebDiscovery = false
    ;(options as any).maxPages = Math.max(Number((options as any).maxPages ?? 1), Math.min(10, seeds.length))
    if (!hints.preferred_channel) {
      ;(options as any).preferred_channel = 'mcp'
      ;(options as any).__preferMcp = true
    }
  }
  if (hints.serp_context) {
    ;(options as any).__serpContext = hints.serp_context
  }
  if (hints.serp_hits?.length) {
    ;(options as any).__serpHits = hints.serp_hits
    ;(options as any).__serpHybrid = true
  }
  if (hints.search_context) {
    ;(options as any).__searchContext = hints.search_context
  }
  if (hints.crawl_strategy) {
    ;(options as any).__crawlStrategy = hints.crawl_strategy
    if (hints.crawl_strategy === 'open_discovery') {
      ;(options as any).__openWebDiscovery = true
    }
  }
  if (hints.source === 'manager') {
    ;(options as any).__fromManager = true
  }
  if (hints.open_web_discovery && !hints.seed_urls?.length) {
    ;(options as any).__openWebDiscovery = true
  }
  return { task: nextTask || task, options }
}
