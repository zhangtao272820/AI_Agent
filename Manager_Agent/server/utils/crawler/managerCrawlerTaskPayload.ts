import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages'
import { safeJsonParse } from '../../graph/core/shared'
import type { TaskConstraints } from '../../graph/core/plan'
import { EMPTY_TASK_CONSTRAINTS } from '../../graph/llm/taskConstraintsLlm'
import {
  extractCrawlerItemsFromPayload,
  extractCrawlerItemsFromText,
  formatSourcesTableMarkdown,
  type CrawlerSourceItem
} from './crawlerItemsParse'
import type { ManagerCrawlerLlmHints } from './managerCrawlerTaskLlm'
import { taskConstraintsFromMeta } from '../../graph/llm/taskConstraintsLlm'
import { buildLeanCrawlerUserTaskSync, resolveLeanCrawlerUserTaskAsync } from './managerCrawlerLeanTaskLlm'
import { searchMaxSeeds } from '../search/managerSearchConfig'
import type { SerpHitPayload } from '../search/managerWebSearch'
import { buildSerpPayloadForCrawl, formatSerpContextFromPayload } from '../search/managerWebSearch'
import type { WebSearchHit } from '../search/webSearchTool'

export type ManagerSearchContext = {
  mode?: 'general' | 'news'
  sub_queries?: string[]
  expected_evidence?: string[]
  tavily_answer?: string
  verify_note?: string
}

/** 与 Extractor `parseManagerTaskJson` / `incoming_task.ts` 对齐 */
export type ManagerCrawlerTaskPayload = {
  source: 'manager'
  refined_task?: string
  hint_fields?: string[]
  preferred_channel?: 'http' | 'browser' | 'mcp'
  must_filters?: string[]
  /** 开放式公网发现（无固定站点 URL），Extractor 应走 Bing 入口而非槽位澄清 */
  open_web_discovery?: boolean
  /** P1：Manager SERP 种子 URL，Extractor 优先精抓 */
  seed_urls?: string[]
  /** P1：SERP 摘要上下文（已截断） */
  serp_context?: string
  /** P2：结构化 SERP 命中（Extractor serp_hybrid 优先消费） */
  serp_hits?: SerpHitPayload[]
  search_context?: ManagerSearchContext
  crawl_strategy?: 'serp_only' | 'crawl_seeds' | 'open_discovery'
}

type SiteHint = {
  targetSite: string
  fields: string[]
  channel: 'http' | 'browser' | 'mcp'
}

const OPEN_WEB_FIELDS = ['title', 'url', 'source', 'excerpt'] as const

/** 去掉总管模板口吻，保留用户真实采集意图（与直连 Extractor UI 一致） */
export function buildLeanCrawlerUserTask(stepOrRouted: string, lastUserMessage: string): string {
  return buildLeanCrawlerUserTaskSync(stepOrRouted, lastUserMessage)
}

/** @deprecated 请使用 inferManagerCrawlerHintsByLlm；无 LLM 结果时返回 null */
export function inferCrawlerSiteHint(_text: string): SiteHint | null {
  return null
}

/** @deprecated 请使用 inferManagerCrawlerHintsByLlm */
export function extractCrawlerLimitHint(_text: string): number | null {
  return null
}

/**
 * 总管 → Extractor 结构化 hint；无额外信息时返回 null（不传 manager_task_json）。
 */
export function buildManagerCrawlerTaskPayload(
  leanTask: string,
  opts?: {
    hasUrl?: boolean
    site?: SiteHint | null
    seedUrls?: string[]
    serpContext?: string
    serpHits?: SerpHitPayload[]
    searchContext?: ManagerSearchContext | null
    crawlStrategy?: ManagerCrawlerTaskPayload['crawl_strategy']
    llmHints?: ManagerCrawlerLlmHints | null
    constraints?: TaskConstraints | null
  },
): ManagerCrawlerTaskPayload | null {
  const q = String(leanTask ?? '').replace(/\s+/g, ' ').trim()
  if (!q) return null

  const c = opts?.constraints ?? { ...EMPTY_TASK_CONSTRAINTS }
  const must: string[] = []
  if (c.timeHints.length) must.push(`时间：${c.timeHints.join('、')}`)
  if (c.subjectHints.length) must.push(`主题：${c.subjectHints.join('、')}`)

  const site = opts?.site ?? opts?.llmHints?.site ?? null
  const seedUrls = (opts?.seedUrls ?? []).map((u) => String(u ?? '').trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, searchMaxSeeds())
  const hasUrl = Boolean(opts?.hasUrl) || seedUrls.length > 0
  const limit = opts?.llmHints?.limit ?? null
  const openWebDiscovery =
    Boolean(opts?.llmHints?.openWebDiscovery) ||
    opts?.crawlStrategy === 'open_discovery'
  const serpCtx = String(opts?.serpContext ?? '').trim().slice(0, 2400)
  const serpHits = (opts?.serpHits ?? []).slice(0, searchMaxSeeds())
  const searchCtx = opts?.searchContext ?? undefined
  const serpBlock =
    serpHits.length > 0
      ? { serp_hits: serpHits, ...(serpCtx ? { serp_context: serpCtx } : {}) }
      : serpCtx
        ? { serp_context: serpCtx }
        : {}
  const contextBlock = searchCtx ? { search_context: searchCtx } : {}
  const strategyBlock = opts?.crawlStrategy ? { crawl_strategy: opts.crawlStrategy } : {}
  const seedBlock =
    seedUrls.length > 0
      ? {
          seed_urls: seedUrls,
          ...serpBlock
        }
      : serpBlock

  if (site) {
    const fields = [...site.fields]
    if (limit) must.push(`数量：${limit}`)
    return {
      source: 'manager',
      refined_task: q,
      hint_fields: fields.slice(0, 12),
      preferred_channel: site.channel,
      ...(must.length ? { must_filters: must } : {}),
      ...seedBlock,
      ...contextBlock,
      ...strategyBlock
    }
  }

  if (hasUrl) {
    return {
      source: 'manager',
      refined_task: q,
      hint_fields: ['title', 'url', 'excerpt'],
      // Manager SERP 种子常遇反爬：云抓取（Firecrawl 等）优先，浏览器兜底
      preferred_channel: seedUrls.length > 0 ? 'mcp' : 'http',
      ...(must.length ? { must_filters: must } : {}),
      ...seedBlock,
      ...contextBlock,
      ...strategyBlock
    }
  }

  if (!openWebDiscovery) return null

  return {
    source: 'manager',
    refined_task: q,
    open_web_discovery: true,
    hint_fields: [...OPEN_WEB_FIELDS],
    preferred_channel: 'mcp',
    must_filters: [
      ...must,
      '优先权威/官方/百科/机构公开来源',
      '默认规避知乎作为首抓来源（除非用户明确要求知乎）',
    ].slice(0, 8),
    ...seedBlock,
    ...contextBlock,
    ...strategyBlock
  }
}

const OPEN_DISCOVERY_SUFFIX = `

要求：
- 进行开放式发现搜索，优先选择权威/官方/百科/机构来源
- 尽量避免知乎作为首抓或首选来源；只有在问题明确要求知乎时才考虑知乎
- 汇总并抓取相关页面，输出 items 数组，字段为：title, url, source, excerpt`

/** 组装 WS task 文本 + manager_task_json（榜单站不加开放式后缀，避免干扰专用解析） */
export function buildManagerCrawlerInvoke(params: {
  stepOrRoutedQuery: string
  lastUserMessage: string
  leanTask?: string
  seedUrls?: string[]
  serpContext?: string
  serpHits?: SerpHitPayload[]
  searchContext?: ManagerSearchContext | null
  crawlStrategy?: ManagerCrawlerTaskPayload['crawl_strategy']
  llmHints?: ManagerCrawlerLlmHints | null
  constraints?: TaskConstraints | null
}): { task: string; managerTask: ManagerCrawlerTaskPayload | null; maxItems?: number } {
  const lean = params.leanTask ?? buildLeanCrawlerUserTask(params.stepOrRoutedQuery, params.lastUserMessage)
  const seedUrls = (params.seedUrls ?? []).filter((u) => /^https?:\/\//i.test(String(u ?? '').trim()))
  const hasUrl = /https?:\/\/\S+/i.test(lean) || seedUrls.length > 0
  const site = params.llmHints?.site ?? null
  const managerTask = buildManagerCrawlerTaskPayload(lean, {
    hasUrl,
    site,
    seedUrls,
    serpContext: params.serpContext,
    serpHits: params.serpHits,
    searchContext: params.searchContext,
    crawlStrategy:
      params.crawlStrategy ??
      (seedUrls.length > 0 || params.serpHits?.length || params.serpContext ? 'crawl_seeds' : undefined),
    llmHints: params.llmHints,
    constraints: params.constraints
  })
  const maxItems = params.llmHints?.limit ?? undefined

  let task = lean
  const openDiscovery = Boolean(params.llmHints?.openWebDiscovery) || Boolean(managerTask?.open_web_discovery)
  if (openDiscovery && !hasUrl && !site) task = `${lean}${OPEN_DISCOVERY_SUFFIX}`
  else if (seedUrls.length > 0 && !site) {
    task = `${lean}\n\n要求：优先抓取以下 Manager 联网检索提供的 URL 种子（共 ${seedUrls.length} 个），输出 items 数组（title, url, source, excerpt）。`
  }

  return { task, managerTask, maxItems }
}

function searchContextFromMeta(meta?: Record<string, unknown> | null): ManagerSearchContext | null {
  if (!meta || typeof meta !== 'object') return null
  const plan = meta.searchPlan as { subQueries?: string[]; expectedEvidence?: string[] } | undefined
  const verify = meta.searchVerify as { missing?: string[]; sufficient?: boolean } | undefined
  const mode = String(meta.searchMode ?? '').trim() as 'general' | 'news'
  const tavily = String(meta.tavilyAnswer ?? '').trim().slice(0, 600)
  const filterNote = String(meta.serpFilterNote ?? '').trim().slice(0, 240)
  const verifyNote = Array.isArray(verify?.missing)
    ? verify!.missing!.map((x) => String(x)).filter(Boolean).join('、').slice(0, 240)
    : filterNote
  const subQueries = Array.isArray(plan?.subQueries)
    ? plan!.subQueries!.map((x) => String(x).trim()).filter(Boolean).slice(0, 6)
    : []
  const expected = Array.isArray(plan?.expectedEvidence)
    ? plan!.expectedEvidence!.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
    : []
  if (!subQueries.length && !expected.length && !tavily && !verifyNote && mode !== 'news') return null
  return {
    ...(mode === 'news' || mode === 'general' ? { mode } : {}),
    ...(subQueries.length ? { sub_queries: subQueries } : {}),
    ...(expected.length ? { expected_evidence: expected } : {}),
    ...(tavily ? { tavily_answer: tavily } : {}),
    ...(verifyNote ? { verify_note: verifyNote } : {})
  }
}

export function resolveCrawlerSerpBundleFromMeta(meta?: Record<string, unknown> | null) {
  const seedUrls = Array.isArray(meta?.seedUrls)
    ? (meta!.seedUrls as unknown[]).map((u) => String(u ?? '').trim()).filter((u) => /^https?:\/\//i.test(u))
    : []
  const searchHits = Array.isArray(meta?.searchHits) ? (meta.searchHits as WebSearchHit[]) : []
  const serpHits = searchHits.length ? buildSerpPayloadForCrawl(searchHits, seedUrls) : []
  const serpContext =
    serpHits.length > 0
      ? formatSerpContextFromPayload(serpHits)
      : String(meta?.serpContext ?? '').trim()
  return { seedUrls, serpHits, serpContext, searchContext: searchContextFromMeta(meta) }
}

/** @deprecated 请用 resolveShouldUseSerpOnlyCrawler；同步路径恒 false，避免正则误判 */
export function shouldUseSerpOnlyCrawler(
  _taskText: string,
  _meta?: Record<string, unknown> | null
): boolean {
  return false
}

/** SERP-only 模式：不调用 Extractor，直接返回联网检索摘要 */
export function buildSerpOnlyCrawlerOutcome(
  meta: Record<string, unknown> | null | undefined,
  userTask: string
): { output: string; raw: Record<string, unknown> | null } | null {
  const raw = buildSerpFallbackCrawlerRaw(meta)
  if (!raw) return null
  const note = '（说明：以下为 Manager 联网检索摘要，供参考对照；非页面全文抓取）'
  const output = `${buildCrawlerResultForManager(raw, userTask)}\n\n${note}`
  return { output, raw }
}

/** 从 state.meta 读取 SERP 种子供 crawler 步骤使用 */
export function crawlerInvokeFromState(
  stepOrRoutedQuery: string,
  lastUserMessage: string,
  meta?: Record<string, unknown> | null,
  llmHints?: ManagerCrawlerLlmHints | null,
  crawlStrategy?: ManagerCrawlerTaskPayload['crawl_strategy'],
) {
  const bundle = resolveCrawlerSerpBundleFromMeta(meta)
  const needsWeb = meta?.needsWebSearch === true
  const mergedHints =
    llmHints ??
    (crawlStrategy === 'open_discovery'
      ? { site: null, limit: null, openWebDiscovery: true }
      : needsWeb
        ? { site: null, limit: null, openWebDiscovery: false }
        : null)
  return buildManagerCrawlerInvoke({
    stepOrRoutedQuery,
    lastUserMessage,
    seedUrls: bundle.seedUrls,
    serpContext: bundle.serpContext || undefined,
    serpHits: bundle.serpHits.length ? bundle.serpHits : undefined,
    searchContext: bundle.searchContext,
    crawlStrategy,
    llmHints: mergedHints,
    constraints: taskConstraintsFromMeta(meta)
  })
}

/** 异步精炼 crawler 任务（LLM 优先） */
export async function crawlerInvokeFromStateAsync(
  stepOrRoutedQuery: string,
  lastUserMessage: string,
  meta?: Record<string, unknown> | null,
  llmHints?: ManagerCrawlerLlmHints | null,
  llm?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string } | null,
  crawlStrategy?: ManagerCrawlerTaskPayload['crawl_strategy'],
) {
  const leanTask = await resolveLeanCrawlerUserTaskAsync({
    stepOrRouted: stepOrRoutedQuery,
    lastUserMessage,
    llm
  })
  const bundle = resolveCrawlerSerpBundleFromMeta(meta)
  const needsWeb = meta?.needsWebSearch === true
  const mergedHints =
    llmHints ??
    (crawlStrategy === 'open_discovery'
      ? { site: null, limit: null, openWebDiscovery: true }
      : needsWeb
        ? { site: null, limit: null, openWebDiscovery: false }
        : null)
  return buildManagerCrawlerInvoke({
    stepOrRoutedQuery,
    lastUserMessage,
    leanTask,
    seedUrls: bundle.seedUrls,
    serpContext: bundle.serpContext || undefined,
    serpHits: bundle.serpHits.length ? bundle.serpHits : undefined,
    searchContext: bundle.searchContext,
    crawlStrategy,
    llmHints: mergedHints,
    constraints: taskConstraintsFromMeta(meta)
  })
}

export function parseCrawlerPayload(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  const parsed = safeJsonParse(String(raw ?? '').trim())
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
}

export function extractCrawlerItems(obj: Record<string, unknown> | null): Array<Record<string, unknown>> {
  return extractCrawlerItemsFromPayload(obj).map((x) => ({
    title: x.title,
    url: x.url,
    source: x.source,
    excerpt: x.excerpt
  }))
}

function escMdCell(v: unknown): string {
  return String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim()
}

/** 规范 Markdown 表格，供总管 UI `CRAWLER_TABLE` 块渲染 */
export function formatCrawlerItemsMarkdownTable(
  items: Array<Record<string, unknown>>,
  maxRows = 25,
): string {
  const rows = items.slice(0, maxRows)
  if (!rows.length) return ''
  const lines = ['| 排名 | 标题 | 评分 | 链接 |', '| --- | --- | --- | --- |']
  for (const it of rows) {
    const rank = it.rank != null ? String(it.rank) : '-'
    const title = escMdCell(it.title ?? it.name) || '-'
    const rating = it.rating != null ? String(it.rating) : '-'
    const urlRaw = escMdCell(it.url)
    const link = urlRaw && /^https?:\/\//i.test(urlRaw) ? `[查看](${urlRaw})` : urlRaw || '-'
    lines.push(`| ${rank} | ${title} | ${rating} | ${link} |`)
  }
  return lines.join('\n')
}

const CRAWLER_TABLE_BEGIN = '<!--CRAWLER_TABLE-->'
const CRAWLER_TABLE_END = '<!--/CRAWLER_TABLE-->'

export function wrapCrawlerTableMarkdown(tableMd: string): string {
  const t = String(tableMd ?? '').trim()
  if (!t) return ''
  return `${CRAWLER_TABLE_BEGIN}\n${t}\n${CRAWLER_TABLE_END}`
}

export function extractCrawlerTableMarkdown(text: string): string {
  const s = String(text ?? '')
  const start = s.indexOf(CRAWLER_TABLE_BEGIN)
  const end = s.indexOf(CRAWLER_TABLE_END)
  if (start >= 0 && end > start) {
    return s.slice(start + CRAWLER_TABLE_BEGIN.length, end).trim()
  }
  return ''
}

/** 将 Manager SERP 命中转为爬虫 items，用于页面 403/拦截时的兜底 */
export function buildSerpFallbackCrawlerRaw(meta?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!meta || typeof meta !== 'object') return null
  const hits = Array.isArray(meta.searchHits) ? meta.searchHits : []
  const items: CrawlerSourceItem[] = []
  for (const h of hits.slice(0, searchMaxSeeds())) {
    const row = h as { title?: string; url?: string; snippet?: string }
    const url = String(row.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) continue
    let source = ''
    try {
      source = new URL(url).hostname.replace(/^www\./i, '')
    } catch {
      source = ''
    }
    items.push({
      title: String(row.title || url).trim().slice(0, 200),
      url,
      source,
      excerpt: String(row.snippet ?? '').trim().slice(0, 400)
    })
  }
  if (!items.length) {
    const ctx = String(meta.serpContext ?? '').trim()
    if (!ctx) return null
    const blocks = ctx.split(/\n(?=\d+\.\s)/)
    for (const block of blocks) {
      const urlM = block.match(/URL:\s*(https?:\/\/\S+)/i)
      const url = urlM ? urlM[1]!.replace(/[)\],.]+$/, '') : ''
      if (!url) continue
      const titleM = block.match(/^\d+\.\s*(.+?)(?:\n|$)/)
      const title = String(titleM?.[1] ?? url).trim()
      const snip = block.replace(/^\d+\.\s*.+\n?/i, '').replace(/URL:.+/i, '').trim()
      let source = ''
      try {
        source = new URL(url).hostname.replace(/^www\./i, '')
      } catch {
        source = ''
      }
      items.push({ title, url, source, excerpt: snip.slice(0, 400) })
    }
  }
  if (!items.length) return null
  return { items, serp_fallback: true, source: 'manager_serp' }
}

export function buildSerpFallbackCrawlerAnswer(meta?: Record<string, unknown> | null, userTask?: string): string | null {
  const raw = buildSerpFallbackCrawlerRaw(meta)
  if (!raw) return null
  const note =
    '（说明：目标站点返回 403/拦截，以下为 Manager 联网检索摘要，非页面全文抓取）'
  return `${buildCrawlerResultForManager(raw, userTask)}\n\n${note}`
}

/** 将爬虫 JSON 转为用户可见 Markdown（含可渲染表格块） */
export function buildCrawlerResultForManager(raw: unknown, userTask?: string): string {
  const obj = parseCrawlerPayload(raw)
  let normalized: CrawlerSourceItem[] = extractCrawlerItemsFromPayload(obj)
  if (!normalized.length && typeof raw === 'string') {
    normalized = extractCrawlerItemsFromText(raw)
  }
  const cap = Math.min(Math.max(normalized.length, 1), 25)
  const slice = normalized.slice(0, cap)

  if (!slice.length) {
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
    return obj ? JSON.stringify(obj, null, 2) : '未从公开网页中获取到相关数据。'
  }

  const table = formatSourcesTableMarkdown(slice, cap)
  const reqNote = `（共 ${slice.length} 条）`
  const list = slice
    .map((it, idx) => `- ${idx + 1}. ${it.title || '—'} | ${it.source || '—'} | ${it.url || '—'}${it.excerpt ? `\n  - ${it.excerpt}` : ''}`)
    .join('\n')
  return `### 网页抓取列表 ${reqNote}\n\n${wrapCrawlerTableMarkdown(table)}\n\n${list}`
}

/** 多轮续问合并（Extractor `task_condense`） */
export function buildCrawlerHistoryFromMessages(messages: BaseMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const m of messages || []) {
    if (m instanceof HumanMessage) {
      const c = String(m.content ?? '').trim()
      if (c) out.push({ role: 'user', content: c })
    } else if (m instanceof AIMessage) {
      const c = String(m.content ?? '').trim()
      if (c) out.push({ role: 'assistant', content: c.slice(0, 400) })
    }
  }
  return out.slice(-6)
}
