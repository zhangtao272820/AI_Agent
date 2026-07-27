import path from 'node:path'
import { writeFile } from 'node:fs/promises'

import { z } from 'zod'
import { StateGraph, StateSchema, START, END, type GraphNode } from '@langchain/langgraph'
import type { ChatOpenAI } from '@langchain/openai'

import { buildExtractTemplateBlock } from '../utils/crawl_extract_templates'
import { enrichItemsFromManagerSearchBundle } from '../utils/serp_excerpt_enrich'
import { buildSerpHitIndex, parseSerpHitsFromOptions, serpHitToItem, serpItemForUrl, shouldSerpFallbackForUrl } from '../utils/serp_hybrid'
import { classifyFailReason } from '../utils/crawl_failure_tags'
import { tryRankingApiFastPath } from './extract/rankingApiFastPath'
import { bumpRunCost, ensureRunCost, runCostToMeta } from '../utils/runCost'
import { getExtractorAgentEnv } from '../utils/extractor_agent_env'
import { loadSessionForHost } from '../utils/crawl_session_store'
import { getCapabilityProfile } from '../services/capabilityRegistry'
import { seedUrlMatchesTargetSite } from './plan/structural'
import { CheckpointManager, DomainRateLimiter, ProxyPool } from '../services/crawlerAgentInfra'
import {
  workerExecute,
  fetchRobotsPolicy,
  type RobotsPolicy,
  type FetchSnapshot,
} from './fetch/runtime'
import { buildSeedFirstPlan } from '../services/crawlerAgentFrontload'
import { uniqByUrl, extractDoubanTop250ListPage, extractJdPhbListPage, extractGenericListPage, extractSeedPageAsSingleItem, constrainItemsToManagerScope } from './extract/generic'
import { type StructuredTaskPlan } from '../services/crawlerAgentTaskPlanning'
import { formatItemsByOutputSpec } from './verify/qualityGate'
import { runVerifierRetries } from './verify/postRun'
import { resolveMinItems } from './verify/qualityGate'
import {
  canonicalizeSeedUrl,
  isBilibiliRankingPageUrl,
  isDouyinRankingPageUrl,
  isToutiaoRankingPageUrl,
  isWeiboRankingPageUrl,
  isZhihuHotPageUrl,
  normalizePlanWithUserLimits,
  parseKugouRankId,
  parseQqMusicToplistId
} from '../services/crawlerAgentTaskUtils'
import {
  fetchBilibiliRankingAll,
  extractBilibiliRankItems,
  extractBilibiliRankFromHtml,
  extractDouyinHotFromHtml,
  extractKugouRankItems,
  extractQqMusicToplistItems,
  extractToutiaoHotFromHtml,
  extractToutiaoHotFromJson,
  extractWeiboHotFromHtml,
  extractZhihuHotFromHtml,
  extractZhihuHotFromNetworkJson,
  extractZhihuHotFromPageContent,
  fetchKugouRankInfo,
  fetchQqMusicToplist,
  fetchToutiaoHot,
  isZhihuHotTaskUrl,
  resolveZhihuHotItems,
} from './extract/rankingSources'

type HostStat = {
  attempts: number
  ok: number
  fail: number
  timeTotalMs: number
  lastError?: string
}

type MemoryState = {
  queue: string[]
  visited: string[]
  pagesFetched: number
  maxPages: number
  maxItems: number
  done: boolean
}

type SessionState = {
  cookies?: any[]
  localStorage?: any
  sessionStorage?: any
}

type Plan = {
  target: string
  seedUrls: string[]
  extraction: { entity: string; fields: string[]; vision?: boolean }
  needsLogin: boolean
  maxPages: number
  maxItems: number
}

const PlanSchema = z.object({
  target: z.string().default(''),
  seedUrls: z.array(z.string()).min(1),
  extraction: z
    .object({
      entity: z.string().default('item'),
      fields: z.array(z.string()).default(['title', 'url']),
      vision: z.boolean().optional().default(false)
    })
    .default({ entity: 'item', fields: ['title', 'url'], vision: false }),
  needsLogin: z.boolean().optional().default(false),
  maxPages: z.number().optional().default(1),
  maxItems: z.number().optional().default(10)
})

function nowTs() {
  return Date.now()
}

function sleep(ms: number, signal?: AbortSignal) {
  const t = Math.max(0, Math.floor(ms))
  if (!t) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, t)
    const onAbort = () => {
      cleanup()
      reject(new Error('aborted'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    if (signal?.aborted) return onAbort()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

function randInt(min: number, max: number) {
  const a = Number.isFinite(min) ? min : 0
  const b = Number.isFinite(max) ? max : 0
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (hi <= lo) return Math.floor(lo)
  return Math.floor(lo + Math.random() * (hi - lo + 1))
}

function normalizeWhitespace(text: string) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function runCrawlerWorkflow(params: {
  task: string
  options: any
  config: any
  signal: AbortSignal
  emitLog: (level: 'info' | 'warn' | 'error', message: string) => void
  emitProgress: (stage: string, done?: number, total?: number) => void
  taskPlan: StructuredTaskPlan
  inferredLimit: number | null
  preflight: any
  buildHeuristicPlan: (task: string, options: any) => any
  plannerWithLlm: (
    task: string,
    model: ChatOpenAI,
    cfg?: any,
    inject?: string,
    taskPlan?: StructuredTaskPlan | null,
  ) => Promise<any>
  createQwenChatModel: (config: any, vision?: boolean) => ChatOpenAI | null
  pickUserAgent: (config: any, taskPlan?: { targetSite?: string }) => string
  decideExecutionStrategy: (p: any) => { useBrowser: boolean; reason: string; preferMcp?: boolean }
}): Promise<any> {
  const GraphState = new StateSchema({
    task: z.string() as any,
    options: (z.any() as any).default(() => ({})),
    plan: (z.any() as any).nullable().default(null),
    memory: (z.any() as any).default(() => null),
    items: (z.any() as any).default(() => []),
    stats: (z.any() as any).default(() => ({})),
    session: (z.any() as any).nullable().default(null)
  } as any)

  const extractorEnv = getExtractorAgentEnv()
  const rateCfg = (() => {
    const base = params?.options?.rateLimit ?? {}
    const defaultInterval = Math.max(50, extractorEnv.domainPoliteDelayMs)
    return {
      tokensPerInterval: Number.isFinite(Number(base.tokensPerInterval)) ? Math.max(1, Math.floor(Number(base.tokensPerInterval))) : 2,
      intervalMs: Number.isFinite(Number(base.intervalMs)) ? Math.max(50, Math.floor(Number(base.intervalMs))) : defaultInterval,
      backoffBaseMs: Number.isFinite(Number(base.backoffBaseMs)) ? Math.max(100, Math.floor(Number(base.backoffBaseMs))) : 1500,
      backoffMaxMs: Number.isFinite(Number(base.backoffMaxMs)) ? Math.max(1000, Math.floor(Number(base.backoffMaxMs))) : 20000,
      perHostOverrides: base.perHostOverrides || {}
    }
  })()
  const limiter = new DomainRateLimiter(
    { tokensPerInterval: rateCfg.tokensPerInterval, intervalMs: rateCfg.intervalMs, backoffBaseMs: rateCfg.backoffBaseMs, backoffMaxMs: rateCfg.backoffMaxMs },
    rateCfg.perHostOverrides
  )
  const cpMgr = (() => {
    const resumeId = String((params?.options as any)?.resumeId ?? '').trim()
    const intervalMs = Number.isFinite(Number((params?.options as any)?.checkpointIntervalMs)) ? Math.max(500, Math.floor(Number((params?.options as any)?.checkpointIntervalMs))) : 5000
    if (!resumeId) return null as CheckpointManager | null
    return new CheckpointManager(path.join(process.cwd(), '.checkpoints'), resumeId, intervalMs)
  })()
  let initialFromCheckpoint: any = null
  if (cpMgr) {
    const loaded = await cpMgr.load()
    if (loaded && loaded.task && String(loaded.task) === String(params.task)) {
      initialFromCheckpoint = loaded
      params.emitLog('info', 'Checkpoint：已加载历史进度，继续执行')
    }
  }
  const robotsPolicyCache = new Map<string, RobotsPolicy | null>()
  const robotsPolicyMode = (() => {
    const m = String((params.options as any)?.robotsPolicy ?? 'strict').trim().toLowerCase()
    if (m === 'off') return 'off'
    if (m === 'warn') return 'warn'
    return 'strict'
  })() as 'strict' | 'warn' | 'off'
  const ensureRobotsAllowed = async (targetUrl: string) => {
    if (robotsPolicyMode === 'off') return { allowed: true as const, crawlDelayMs: 0, reason: 'disabled' }
    let origin = ''
    try {
      origin = new URL(targetUrl).origin
    } catch {
      return { allowed: true as const, crawlDelayMs: 0, reason: 'invalid_url' }
    }
    if (!origin) return { allowed: true as const, crawlDelayMs: 0, reason: 'empty_origin' }
    if (!robotsPolicyCache.has(origin)) {
      const policy = await fetchRobotsPolicy(targetUrl, params.config, params.signal).catch(() => null)
      robotsPolicyCache.set(origin, policy)
    }
    const policy = robotsPolicyCache.get(origin) ?? null
    if (!policy) return { allowed: true as const, crawlDelayMs: 0, reason: 'no_policy' }
    return { allowed: policy.allows(targetUrl), crawlDelayMs: policy.crawlDelayMs, reason: 'policy_applied' }
  }

  const nodePlanner: GraphNode<typeof GraphState> = async (state) => {
    params.emitLog('info', 'Planner：开始分析任务并制定计划')
    params.emitProgress('planner', 0, 1)
    const heuristic = params.buildHeuristicPlan(state.task, state.options as any)
    const taskPlan = (state.options as any)?.__taskPlan as StructuredTaskPlan | undefined
    const managerSeeds = Array.isArray((state.options as any)?.__managerSeedUrls)
      ? ((state.options as any).__managerSeedUrls as unknown[])
          .map((u) => String(u ?? '').trim())
          .filter((u) => /^https?:\/\//i.test(u))
          .slice(0, 12)
      : [] as string[]
    const hasManagerSeeds = managerSeeds.length > 0
    const crawlStrategy = String((state.options as any)?.__crawlStrategy ?? '').trim()
    if (crawlStrategy === 'serp_only') {
      const serpHits = parseSerpHitsFromOptions(state.options as Record<string, unknown>)
      const serpItems = serpHits.map((h) => serpHitToItem(h))
      const serpCtx = String((state.options as any)?.__serpContext ?? '').trim()
      params.emitLog('info', `Planner：SERP-only 模式，直接使用 Manager 检索摘要（${serpItems.length} 条）`)
      params.emitProgress('planner', 1, 1)
      const planOut = normalizePlanWithUserLimits(
        { ...heuristic, seedUrls: ['about:blank#serp_only'], maxPages: 0 },
        state.task,
        state.options as any,
      )
      const enriched = enrichItemsFromManagerSearchBundle(serpItems, {
        serpContext: serpCtx,
        serpHits,
        tavilyAnswer: String((state.options as any)?.__searchContext?.tavily_answer ?? '').trim(),
      })
      return { plan: planOut, items: enriched, memory: { queue: [], visited: [], pagesFetched: 0, maxPages: 0, maxItems: enriched.length, done: true } }
    }
    if (hasManagerSeeds) {
      const seedPlan = buildSeedFirstPlan(managerSeeds, state.options as any, taskPlan)
      Object.assign(heuristic, seedPlan)
      if (taskPlan) {
        ;(taskPlan as StructuredTaskPlan).openWebSearch = false
      }
      ;(state.options as any).__openWebDiscovery = false
      ;(state.options as any).__seedFirstMode = true
      const serpCtx = String((state.options as any)?.__serpContext ?? '').trim()
      if (String(seedPlan.target) === 'douban_top250' || String(seedPlan.target ?? '').endsWith('_top250')) {
        params.emitLog(
          'info',
          `Planner：补丁直抓（${seedPlan.target}），种子 ${seedPlan.seedUrls?.length ?? 0} 页；跳过 manager_seeds 摘要与 LLM`,
        )
      } else {
        params.emitLog(
          'info',
          `Planner：Seed-first（总管种子 ${managerSeeds.length} 个），跳过 LLM/Bing${serpCtx ? `；SERP 摘要 ${serpCtx.length} 字` : ''}`,
        )
      }
      const serpOnly = Array.isArray((state.options as any)?.__serpOnlyItems)
        ? ((state.options as any).__serpOnlyItems as Record<string, unknown>[])
        : []
      if (serpOnly.length) {
        params.emitLog(
          'info',
          `Planner：SERP 混合模式，${serpOnly.length} 个高摩擦 URL 直接使用检索摘要（跳过浏览器深抓）`
        )
      }
      params.emitProgress('planner', 1, 1)
      const planOut = normalizePlanWithUserLimits(heuristic, state.task, state.options as any)
      return serpOnly.length ? { plan: planOut, items: serpOnly } : { plan: planOut }
    } else {
      const prof = taskPlan ? getCapabilityProfile(taskPlan.targetSite as any, taskPlan.contentType as any) : null
      if (prof?.defaultSeedUrls?.length) {
        heuristic.seedUrls = prof.defaultSeedUrls.slice(0, 3)
      }
      if (taskPlan?.targetSite === 'douban' && taskPlan.contentType === 'ranking') {
        heuristic.target = 'douban_top250'
        heuristic.seedUrls = ['https://movie.douban.com/top250']
        heuristic.extraction = { entity: 'movie', fields: ['rank', 'title', 'rating', 'quote', 'info', 'url'], vision: false }
        ;(taskPlan as StructuredTaskPlan).fields = ['rank', 'title', 'rating', 'url']
      }
    }
    if (taskPlan?.fields?.length) {
      heuristic.extraction = {
        ...heuristic.extraction,
        fields: Array.from(new Set([...heuristic.extraction.fields, ...taskPlan.fields])).slice(0, 12)
      }
    }
    if (Number.isFinite(Number(taskPlan?.limit)) && Number(taskPlan!.limit) > 0) {
      ;(state.options as any).maxItems = Number(taskPlan!.limit)
    }
    const mode = String((params.config as any)?.plannerMode || 'auto').toLowerCase()
    const model = params.createQwenChatModel(params.config)
    const structuralLocked =
      Boolean(taskPlan) &&
      taskPlan!.targetSite !== 'generic' &&
      Number(taskPlan!.confidence ?? 0) >= 0.72
    // 当有Manager种子或结构性已锁定站点时，跳过 LLM 规划，避免种子被重写为错误站点
    if (!model || mode === 'heuristic' || managerSeeds.length > 0 || structuralLocked) {
      params.emitLog(
        'info',
        `Planner：使用规则解析计划；target=${heuristic.target} seed=${heuristic.seedUrls?.[0] || ''}${structuralLocked ? '（结构性站点锁定）' : ''}`
      )
      params.emitProgress('planner', 1, 1)
      return { plan: normalizePlanWithUserLimits(heuristic, state.task, state.options as any) }
    }

    const planInject = String((state.options as any)?.__injectBlocks?.plan ?? '').trim()
    const llmPlan = await params
      .plannerWithLlm(state.task, model, params.config, planInject || undefined, taskPlan)
      .catch(() => null)
    const llmSeed = String(llmPlan?.seedUrls?.[0] ?? '').trim()
    const llmLooksBad =
      !llmPlan ||
      !Array.isArray(llmPlan.seedUrls) ||
      llmPlan.seedUrls.length < 1 ||
      !llmSeed ||
      (taskPlan &&
        taskPlan.targetSite !== 'generic' &&
        !seedUrlMatchesTargetSite(llmSeed, taskPlan.targetSite)) ||
      (llmPlan.target === 'douban_top250' &&
        !/movie\.douban\.com\/top250/i.test(canonicalizeSeedUrl(state.task, llmSeed, taskPlan))) ||
      /example\.com/i.test(llmSeed)

    if (mode === 'llm') {
      if (llmLooksBad) {
        params.emitLog('warn', 'Planner：AI 计划不可靠，回退至规则计划以保证可用性')
        params.emitProgress('planner', 1, 1)
        return { plan: normalizePlanWithUserLimits(heuristic, state.task, state.options as any) }
      }
      params.emitLog('info', `Planner：AI 已生成计划（目标=${llmPlan.target}，种子 URL=${llmPlan.seedUrls[0]}）`)
      params.emitProgress('planner', 1, 1)
      return { plan: normalizePlanWithUserLimits(llmPlan, state.task, state.options as any) }
    }

    if (llmLooksBad) {
      params.emitLog('info', `Planner：使用规则解析计划；target=${heuristic.target} seed=${heuristic.seedUrls?.[0] || ''}`)
      params.emitProgress('planner', 1, 1)
      return { plan: normalizePlanWithUserLimits(heuristic, state.task, state.options as any) }
    }

    params.emitLog('info', `Planner：AI 已生成计划（目标=${llmPlan.target}，种子 URL=${llmPlan.seedUrls[0]}）`)
    params.emitProgress('planner', 1, 1)
    return { plan: normalizePlanWithUserLimits(llmPlan, state.task, state.options as any) }
  }

  const nodeOrchestrator: GraphNode<typeof GraphState> = async (state) => {
    const planParsed = PlanSchema.safeParse(state.plan)
    if (!planParsed.success) throw new Error('invalid plan')
    const plan = planParsed.data as Plan
    const model = params.createQwenChatModel(params.config, plan.extraction.vision)
    const proxyFilePath =
      String((state.options as any)?.proxyFilePath ?? params.config?.crawler?.proxyFilePath ?? '').trim() ||
      path.join(process.cwd(), 'proxies.txt')
    const proxyPool = proxyFilePath ? new ProxyPool(proxyFilePath) : null

    const maxPages = Number(plan.maxPages ?? 1)
    const maxItems = Number(plan.maxItems ?? 10)
    const baseConcurrency = Number((state.options as any)?.maxConcurrency ?? 3)
    const maxConcurrency = plan.target === 'douban_top250' ? 1 : baseConcurrency

    const memory: MemoryState = (() => {
      const m = state.memory as any
      const initialQueue = plan.seedUrls.slice(0, maxPages)
      const queue = Array.isArray(m?.queue) ? m.queue.map(String) : initialQueue
      const visited = Array.isArray(m?.visited) ? m.visited.map(String) : []
      const pagesFetched = Number.isFinite(Number(m?.pagesFetched)) ? Math.floor(Number(m.pagesFetched)) : 0
      const done = Boolean(m?.done)
      return { queue, visited, pagesFetched, maxPages, maxItems, done }
    })()
    const visitedSet = new Set(memory.visited)
    const hostStats: Record<string, HostStat> = (state.stats && typeof state.stats === 'object' ? { ...(state.stats as any) } : {}) as Record<string, HostStat>
    ;(state.options as any).__runStats = hostStats

    if (params.signal.aborted) throw new Error('aborted')
    if (memory.done) {
      params.emitProgress('pages', memory.pagesFetched, maxPages)
      params.emitProgress('items', Array.isArray(state.items) ? (state.items as any[]).length : 0, maxItems)
      return {
        memory,
        items: uniqByUrl(Array.isArray(state.items) ? (state.items as MovieItem[]) : []),
        stats: hostStats
      }
    }

    const urlsToProcess = memory.queue.splice(0, Math.min(memory.queue.length, maxConcurrency))
    if (urlsToProcess.length === 0) {
      memory.done = true
      params.emitProgress('pages', memory.pagesFetched, maxPages)
      params.emitProgress('items', Array.isArray(state.items) ? (state.items as any[]).length : 0, maxItems)
      if (cpMgr) await cpMgr.maybeSave({ task: params.task, plan, memory, items: state.items, stats: hostStats })
      return { memory, items: state.items, stats: hostStats }
    }

    params.emitLog('info', `Master：并行处理 ${urlsToProcess.length} 个页面`)
    params.emitProgress('pages', memory.pagesFetched, maxPages)
    params.emitProgress('items', Array.isArray(state.items) ? (state.items as any[]).length : 0, maxItems)

    const workerPromises = urlsToProcess.map(async (url) => {
      if (visitedSet.has(url)) return null
      if (url === 'about:blank#serp_only') return []
      memory.visited.push(url)
      visitedSet.add(url)
      const robotsCheck = await ensureRobotsAllowed(url)
      if (!robotsCheck.allowed) {
        if (robotsPolicyMode === 'warn') {
          params.emitLog('warn', `Worker：robots.txt 禁止抓取（warn 模式继续执行）${url}`)
        } else {
          params.emitLog('warn', `Worker：robots.txt 禁止抓取，已跳过 ${url}`)
          return []
        }
      }
      const host = (() => {
        try {
          return new URL(url).hostname
        } catch {
          return ''
        }
      })()
      if (host) await limiter.awaitSlot(host, params.signal)
      if (robotsCheck.crawlDelayMs > 0) {
        await sleep(robotsCheck.crawlDelayMs, params.signal)
      }

      if ((params.config?.agentMode ?? 'smart') !== 'llm') {
        const taskPlanEarly = (state.options as any)?.__taskPlan as StructuredTaskPlan | undefined
        const remainEarly = maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0)
        const apiItems = await tryRankingApiFastPath({
          url,
          taskPlan: taskPlanEarly,
          userAgent: params.pickUserAgent(params.config, params.taskPlan),
          signal: params.signal,
          maxItems: remainEarly,
          session: state.session,
          emitLog: (level, msg) => params.emitLog(level, msg),
          fetchPage: async (pageUrl, useBrowser) => {
            const snap = await workerExecute(
              pageUrl,
              params.config,
              { ...(state.options as any), useBrowser: useBrowser || (state.options as any)?.useBrowser },
              params.signal,
              state.session,
              proxyPool,
              params.emitLog,
              !useBrowser && !Boolean((state.options as any)?.useBrowser),
              state.task,
            )
            return { html: snap.html, networkJson: snap.networkJson ?? [] }
          },
        })
        if (apiItems?.length) return apiItems
      }

      if ((params.config?.agentMode ?? 'smart') !== 'llm' && /api\.bilibili\.com\/x\/web-interface\/ranking/i.test(url)) {
        const remain = maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0)
        try {
          const payload = await fetchBilibiliRankingAll(params.pickUserAgent(params.config, params.taskPlan), params.signal)
          let items = extractBilibiliRankItems(payload, remain) as any
          if (items.length > 0) return items
        } catch {}
        return []
      }

      const taskPlanEarly = (state.options as any)?.__taskPlan as StructuredTaskPlan | undefined
      if (
        isZhihuHotTaskUrl(url) ||
        (taskPlanEarly?.targetSite === 'zhihu' && taskPlanEarly?.contentType === 'ranking')
      ) {
        const remain = maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0)
        const items = await resolveZhihuHotItems({
          userAgent: params.pickUserAgent(params.config, params.taskPlan),
          signal: params.signal,
          session: state.session,
          maxItems: remain,
          emitLog: (level, msg) => params.emitLog(level, msg),
          fetchPage: async (pageUrl, useBrowser) => {
            const snap = await workerExecute(
              pageUrl,
              params.config,
              { ...(state.options as any), useBrowser: useBrowser || (state.options as any)?.useBrowser },
              params.signal,
              state.session,
              proxyPool,
              params.emitLog,
              !useBrowser && !Boolean((state.options as any)?.useBrowser),
              state.task,
            )
            return { html: snap.html, networkJson: snap.networkJson ?? [] }
          },
        })
        return items as any[]
      }

      if (/toutiao\.com\/api\/pc\/hot\/hot_board/i.test(url)) {
        const remain = maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0)
        try {
          const payload = await fetchToutiaoHot(params.pickUserAgent(params.config, params.taskPlan), params.signal)
          const items = extractToutiaoHotFromJson(payload, remain) as any
          if (items.length > 0) return items
        } catch {}
      }

      const qqTopId = parseQqMusicToplistId(url)
      if ((params.config?.agentMode ?? 'smart') !== 'llm' && qqTopId) {
        const payload = await fetchQqMusicToplist(qqTopId, params.pickUserAgent(params.config, params.taskPlan), params.signal)
        const items = extractQqMusicToplistItems(qqTopId, payload, maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0)) as any
        return items
      }

      const kgRankId = parseKugouRankId(url)
      if ((params.config?.agentMode ?? 'smart') !== 'llm' && kgRankId) {
        const payload = await fetchKugouRankInfo(kgRankId, 1, params.pickUserAgent(params.config, params.taskPlan), params.signal)
        const items = extractKugouRankItems(kgRankId, payload, maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0)) as any
        return items
      }

      const taskPlan = (state.options as any)?.__taskPlan as StructuredTaskPlan | undefined
      const lastFailureTags = Array.isArray((state.options as any)?.__lastFailureTags)
        ? ((state.options as any).__lastFailureTags as string[])
        : []
      const strategy = params.decideExecutionStrategy({
        task: state.task,
        url,
        taskPlan,
        userForcedBrowser: Boolean((state.options as any)?.useBrowser),
        agentMode: String(params.config?.agentMode ?? 'smart'),
        preferredChannel: (state.options as any)?.preferred_channel,
        antiBotRisk: params.preflight?.antiBotRisk,
        lastFailureTags,
      })
      if (!(state.options as any)._routeLog) (state.options as any)._routeLog = []
      ;(state.options as any)._routeLog.push({ reason: strategy.reason, useBrowser: strategy.useBrowser, preferMcp: strategy.preferMcp, url })
      if (strategy.preferMcp) (state.options as any).__preferMcp = true
      const fastPath = !strategy.useBrowser
      const seedFirstHybrid =
        Boolean((state.options as any)?.__seedFirstMode) && Boolean((state.options as any)?.__serpHybrid)
      // HTTP 优先 / 低风险 / 内置榜单：短间隔；避免每页 1–5s 空等拖长日志
      const lowRiskHttp =
        !strategy.preferMcp &&
        !strategy.useBrowser &&
        (strategy.reason === 'preferred_http' ||
          strategy.reason === 'capability_profile_http' ||
          plan.target === 'douban_top250' ||
          params.preflight?.antiBotRisk === 'low')
      await sleep(
        seedFirstHybrid || lowRiskHttp ? randInt(80, 280) : randInt(1000, 5000),
        params.signal,
      )

      const t0 = Date.now()
      try {
        const snapshot = await workerExecute(url, params.config, state.options as any, params.signal, state.session, proxyPool, params.emitLog, fastPath, state.task)
        const dt = Date.now() - t0
        if (host) {
          const s = (hostStats[host] = hostStats[host] || { attempts: 0, ok: 0, fail: 0, timeTotalMs: 0 })
          s.attempts += 1
          s.ok += 1
          s.timeTotalMs += dt
        }
        let newItems: any[] = []
        let nextUrl: string | null = null

        if (plan.target === 'douban_top250') {
          const res = extractDoubanTop250ListPage(snapshot.html)
          newItems = res.items
          nextUrl = res.nextUrl
        } else if (
          (state.options as any)?.__taskPlan?.targetSite === 'jd' &&
          /\/phb\//i.test(snapshot.finalUrl || url)
        ) {
          const res = extractJdPhbListPage(snapshot.html, maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0))
          newItems = res.items
          nextUrl = res.nextUrl
        } else if (isBilibiliRankingPageUrl(snapshot.finalUrl || url)) {
          const remain = maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0)
          newItems = extractBilibiliRankFromHtml(snapshot.html, remain) as any
          nextUrl = null
        } else if (isWeiboRankingPageUrl(snapshot.finalUrl || url)) {
          const remain = maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0)
          newItems = extractWeiboHotFromHtml(snapshot.html, remain) as any
          nextUrl = null
        } else if (isToutiaoRankingPageUrl(snapshot.finalUrl || url)) {
          const remain = maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0)
          newItems = extractToutiaoHotFromHtml(snapshot.html, remain) as any
          nextUrl = null
        } else if (isDouyinRankingPageUrl(snapshot.finalUrl || url)) {
          const remain = maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0)
          newItems = extractDouyinHotFromHtml(snapshot.html, remain) as any
          nextUrl = null
        } else if (isZhihuHotPageUrl(snapshot.finalUrl || url)) {
          const remain = maxItems - (Array.isArray(state.items) ? (state.items as MovieItem[]).length : 0)
          const fromNet = extractZhihuHotFromNetworkJson(snapshot.networkJson ?? [], remain)
          newItems = (fromNet.length > 0 ? fromNet : extractZhihuHotFromPageContent(snapshot.html, remain)) as any
          nextUrl = null
        } else if (plan.target === 'manager_seeds') {
          // 防御：站点锁种子若仍落到 manager_seeds，豆瓣 Top250 必须走补丁结构化抽取
          const pageUrl = String(snapshot.finalUrl || url || '')
          if (/movie\.douban\.com\/top250/i.test(pageUrl)) {
            const res = extractDoubanTop250ListPage(snapshot.html)
            newItems = res.items
            nextUrl = res.nextUrl
            if (newItems.length) {
              params.emitLog('info', `Worker：manager_seeds 命中豆瓣 Top250，改走补丁抽取 ${newItems.length} 条`)
            }
          } else {
            const serpHits = parseSerpHitsFromOptions(state.options as Record<string, unknown>)
            const hit = serpItemForUrl(serpHits, url)
            const single = extractSeedPageAsSingleItem(snapshot, url, hit ? { title: hit.title, snippet: hit.excerpt } : undefined)
            if (single) {
              newItems = [single]
            } else if (hit) {
              newItems = [hit]
            } else {
              newItems = []
            }
            nextUrl = null
          }
        } else {
          const templateBlock = String((state.options as any)?.__templateBlock ?? '').trim()
          const planWithHint = templateBlock ? { ...plan, templateBlock } : plan
          const res = await extractGenericListPage(snapshot as FetchSnapshot, planWithHint as any, model, String(state.task ?? ''), {
            runCostHost: state.options as Record<string, unknown>,
            targetSite: taskPlan?.targetSite,
            contentType: taskPlan?.contentType,
          })
          newItems = res.items
          nextUrl = res.nextUrl
        }

        if (nextUrl && !visitedSet.has(nextUrl) && (memory.queue.length + memory.visited.length) < maxPages) {
          memory.queue.push(nextUrl)
        }
        if (!newItems.length) {
          const serpHits = parseSerpHitsFromOptions(state.options as Record<string, unknown>)
          if (shouldSerpFallbackForUrl(serpHits, url, '', true)) {
            const fallback = serpItemForUrl(serpHits, url)
            if (fallback) {
              params.emitLog('info', `Worker：页面无有效字段，回退 SERP 摘要：${url}`)
              return [fallback]
            }
          }
        }
        return newItems
      } catch (e: any) {
        const dt = Date.now() - t0
        const errMsg = String(e?.message ?? e ?? '')
        const serpHits = parseSerpHitsFromOptions(state.options as Record<string, unknown>)
        const failTag = classifyFailReason(errMsg)
        const prevTags = Array.isArray((state.options as any)?.__lastFailureTags)
          ? ((state.options as any).__lastFailureTags as string[])
          : []
        ;(state.options as any).__lastFailureTags = [...new Set([...prevTags, failTag])]
        if (shouldSerpFallbackForUrl(serpHits, url, errMsg, seedFirstHybrid)) {
          const fallback = serpItemForUrl(serpHits, url)
          if (fallback) {
            params.emitLog('info', `Worker：抓取失败，回退 SERP 摘要：${url}`)
            if (host) {
              const s = (hostStats[host] = hostStats[host] || { attempts: 0, ok: 0, fail: 0, timeTotalMs: 0 })
              s.attempts += 1
              s.ok += 1
              s.timeTotalMs += dt
            }
            return [fallback]
          }
        }
        if (host) {
          const s = (hostStats[host] = hostStats[host] || { attempts: 0, ok: 0, fail: 0, timeTotalMs: 0 })
          s.attempts += 1
          s.fail += 1
          s.timeTotalMs += dt
          s.lastError = errMsg
          if (/\b429\b/i.test(s.lastError) || /too many/i.test(s.lastError)) limiter.backoff(host, 2)
          if (/\b403\b/i.test(s.lastError) || /forbidden/i.test(s.lastError)) limiter.backoff(host, 1)
        }
        params.emitLog('warn', `Worker：单 URL 抓取失败，已跳过继续其它种子：${url}；原因=${errMsg.slice(0, 120)}`)
        return []
      }
    })

    const results = await Promise.all(workerPromises)
    const allNewItems = results.flat().filter(Boolean) as any[]
    const currentItems = Array.isArray(state.items) ? (state.items as any[]) : []
    const taskPlan = (state.options as any)?.__taskPlan as StructuredTaskPlan | undefined
    const mergeCap =
      taskPlan?.openWebSearch && taskPlan.targetSite === 'generic'
        ? Math.min(80, Math.max(maxItems + 24, 36))
        : maxItems
    const merged = uniqByUrl([...currentItems, ...allNewItems]).slice(0, mergeCap)

    const touchedBingSerp = urlsToProcess.some((u) => {
      try {
        const h = new URL(u).hostname.toLowerCase()
        return h.includes('bing.com') && /\/search/i.test(`${u.pathname}${u.search}`)
      } catch {
        return false
      }
    })
    let serpFollowPushed = 0
    if (taskPlan?.openWebSearch && !((state.options as any)?.__seedFirstMode) && touchedBingSerp) {
      const pageBudgetAfterBatch = memory.pagesFetched + urlsToProcess.length
      const room = Math.max(0, maxPages - pageBudgetAfterBatch)
      const maxFollow = Math.min(6, room, Math.max(maxItems, 6))
      const qset = new Set(memory.queue.map(String))
      for (const it of allNewItems) {
        if (serpFollowPushed >= maxFollow) break
        const link = String((it as any)?.url ?? '').trim()
        if (!/^https?:\/\//i.test(link)) continue
        if (/bing\.com/i.test(link)) continue
        if (visitedSet.has(link) || qset.has(link)) continue
        memory.queue.push(link)
        qset.add(link)
        serpFollowPushed += 1
      }
      if (serpFollowPushed > 0) {
        params.emitLog('info', `Master：公网检索二跳，已将 ${serpFollowPushed} 条外链加入抓取队列`)
      }
    }

    memory.pagesFetched += urlsToProcess.length
    const itemSaturated = merged.length >= maxItems
    const deferDoneForOpenWeb =
      Boolean(taskPlan?.openWebSearch) && serpFollowPushed > 0 && memory.queue.length > 0
    if (memory.pagesFetched >= maxPages || memory.queue.length === 0 || (itemSaturated && !deferDoneForOpenWeb)) {
      memory.done = true
    }
    params.emitProgress('pages', memory.pagesFetched, maxPages)
    params.emitProgress('items', merged.length, maxItems)

    if (cpMgr) await cpMgr.maybeSave({ task: params.task, plan, memory, items: merged, stats: hostStats })

    return { memory, items: merged, stats: hostStats }
  }

  const nodeVerifier: GraphNode<typeof GraphState> = async (state) => {
    const items = Array.isArray(state.items) ? (state.items as any[]) : []
    const unique = uniqByUrl(items as any)
    params.emitLog('info', `Verifier：数据校验完成，共 ${unique.length} 条有效数据`)
    params.emitProgress('verifier', unique.length, unique.length)
    return { items: unique }
  }

  const afterOrchestrator = (state: any) => {
    const plan = state.plan as Plan
    if (plan.needsLogin && !state.session) return 'login'
    return state?.memory?.done ? 'verifier' : 'orchestrator'
  }

  const nodeLogin: GraphNode<typeof GraphState> = async (state) => {
    const seed = String((state.plan as Plan)?.seedUrls?.[0] ?? '').trim()
    let host = ''
    try {
      host = new URL(seed).hostname
    } catch {}
    const stored = host ? loadSessionForHost(host) : null
    if (stored?.cookies?.length) {
      params.emitLog('info', `Session：使用已存登录态 ${host}（${stored.cookies.length} cookies）`)
      return { session: { cookies: stored.cookies } }
    }
    params.emitLog('warn', '系统检测到需要登录，但未找到该站点已存会话；请在浏览器中完成登录后重试。')
    return { session: state.session ?? null }
  }

  const graph = new StateGraph(GraphState)
    .addNode('planner', nodePlanner)
    .addNode('orchestrator', nodeOrchestrator)
    .addNode('verifier', nodeVerifier)
    .addNode('login', nodeLogin)
    .addEdge(START, 'planner')
    .addEdge('planner', 'orchestrator')
    .addConditionalEdges('orchestrator', afterOrchestrator, {
      login: 'login',
      verifier: 'verifier',
      orchestrator: 'orchestrator'
    })
    .addEdge('login', 'orchestrator')
    .addEdge('verifier', END)
    .compile()

  const startedAt = new Date().toISOString()
  const mergedOptions: any = { ...(params.options ?? {}) }
  if (!Number.isFinite(Number(mergedOptions.__mcpMaxCalls))) {
    mergedOptions.__mcpMaxCalls = getExtractorAgentEnv().mcpMaxCallsDefault
  }
  if (mergedOptions.preferred_channel === 'mcp') mergedOptions.__preferMcp = true
  if ((!Number.isFinite(Number(mergedOptions.maxItems)) || Number(mergedOptions.maxItems) <= 0) && params.inferredLimit) {
    mergedOptions.maxItems = params.inferredLimit
  }
  mergedOptions.__taskPlan = params.taskPlan
  if (!(mergedOptions as any).__runStats) (mergedOptions as any).__runStats = { _events: [] }
  ensureRunCost(mergedOptions as Record<string, unknown>)
  const invokeInit: any = { task: params.task, options: mergedOptions }
  if (initialFromCheckpoint) {
    invokeInit.plan = initialFromCheckpoint.plan ?? null
    invokeInit.memory = initialFromCheckpoint.memory ?? null
    invokeInit.items = Array.isArray(initialFromCheckpoint.items) ? initialFromCheckpoint.items : []
    invokeInit.stats = initialFromCheckpoint.stats ?? {}
    invokeInit.session = initialFromCheckpoint.session ?? null
  } else {
    const seedMatch = String(params.task ?? '').match(/https?:\/\/[^\s]+/)
    const prof = getCapabilityProfile(params.taskPlan.targetSite as any, params.taskPlan.contentType as any)
    const previewSeed = seedMatch?.[0] || prof?.defaultSeedUrls?.[0] || ''
    if (previewSeed) {
      try {
        const host = new URL(previewSeed).hostname
        const stored = loadSessionForHost(host)
        if (stored?.cookies?.length) {
          invokeInit.session = { cookies: stored.cookies }
          params.emitLog('info', `Session：已加载 ${host} 的历史 cookie（${stored.cookies.length} 条）`)
        }
      } catch {}
    }
  }
  const templateBlock = [
    buildExtractTemplateBlock(
      String((mergedOptions as any).__rawTaskForTemplates ?? params.task),
      params.taskPlan?.targetSite,
      params.taskPlan?.contentType,
    ),
    String((mergedOptions as any).__injectBlocks?.extract ?? '').trim(),
  ]
    .filter(Boolean)
    .join('\n\n')
  if (templateBlock) {
    ;(mergedOptions as any).__templateBlock = templateBlock
    params.emitLog('info', 'Planner：已注入相似抽取模板回放')
  }
  const finalStateRaw = await graph.invoke(invokeInit)

  const serpContext = String((mergedOptions as any).__serpContext ?? '').trim()
  const serpHits = parseSerpHitsFromOptions(mergedOptions as Record<string, unknown>)
  const parseSerpContextItems = (ctx: string) => {
    const out: Array<{ title: string; url: string; source: string; excerpt: string }> = []
    for (const block of ctx.split(/\n(?=\d+\.\s)/)) {
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
      out.push({ title, url, source, excerpt: snip.slice(0, 400) })
    }
    if (!out.length && serpHits.length) {
      for (const h of serpHits) out.push(serpHitToItem(h))
    }
    return out
  }

  let finalState = finalStateRaw
  const existingItems = Array.isArray(finalStateRaw?.items) ? finalStateRaw.items : []
  if (!existingItems.length && serpContext) {
    const fromSerp = parseSerpContextItems(serpContext)
    if (fromSerp.length) {
      finalState = { ...finalStateRaw, items: fromSerp, meta: { ...(finalStateRaw as any)?.meta, serp_fallback: true } }
      params.emitLog('info', `Verifier：抓取结果为空，已回退 Manager SERP 摘要（${fromSerp.length} 条）`)
      ;(mergedOptions as any).__runCost = (mergedOptions as any).__runCost ?? {}
      bumpRunCost(mergedOptions as Record<string, unknown>, { serp_fallback_used: true, extract_path: 'serp_fallback' })
    }
  }

  if (Array.isArray((finalState as any)?.items)) {
    const searchCtx = (mergedOptions as any)?.__searchContext as { tavily_answer?: string } | undefined
    let items = enrichItemsFromManagerSearchBundle((finalState as any).items as Record<string, unknown>[], {
      serpContext,
      serpHits,
      tavilyAnswer: String(searchCtx?.tavily_answer ?? '').trim(),
    })
    if (Boolean((mergedOptions as any)?.__seedFirstMode)) {
      const seeds = Array.isArray((mergedOptions as any)?.__managerSeedUrls)
        ? ((mergedOptions as any).__managerSeedUrls as string[])
        : []
      const serpUrls = serpHits.map((h) => h.url)
      const cap = Number((mergedOptions as any)?.maxItems ?? 25)
      items = constrainItemsToManagerScope(items as any[], seeds, serpUrls, cap) as typeof items
      if (!items.length && serpHits.length) {
        items = serpHits.map((h) => serpHitToItem(h)) as typeof items
        params.emitLog('info', `Verifier：深抓无有效正文，已回退全部 Manager SERP 命中（${items.length} 条）`)
      }
    }
    finalState = { ...finalState, items }
  }

  const { evalResult, selectedState, retryMeta } = await runVerifierRetries({
    graph,
    task: params.task,
    config: params.config,
    taskPlan: params.taskPlan,
    inferredLimit: Number.isFinite(Number(params.inferredLimit)) ? Number(params.inferredLimit) : null,
    mergedOptions,
    finalState,
    emitLog: params.emitLog,
  })
  const requestedLimitForScore = (() => {
    const fromPlan = Number(params.taskPlan?.limit)
    if (Number.isFinite(fromPlan) && fromPlan > 0) return Math.floor(fromPlan)
    const inferred = Number(params.inferredLimit)
    if (Number.isFinite(inferred) && inferred > 0) return Math.floor(inferred)
    return null
  })()

  const finishedAt = new Date().toISOString()
  const itemCap = Math.min(
    250,
    Math.max(1, Number(requestedLimitForScore ?? mergedOptions.maxItems ?? params.inferredLimit ?? 10)),
  )
  const cappedItems = evalResult.itemsAfterPlan.slice(0, itemCap)
  const formattedOutput = formatItemsByOutputSpec(cappedItems as any, params.taskPlan.outputSpec)

  const result = {
    task: params.task,
    startedAt,
    finishedAt,
    stats: {
      ...((selectedState as any).stats ?? {}),
      _routeLog: Array.isArray((mergedOptions as any)._routeLog) ? (mergedOptions as any)._routeLog : [],
      _events: Array.isArray((mergedOptions as any).__runStats?._events)
        ? (mergedOptions as any).__runStats._events
        : [],
      _channelTrace: Array.isArray((mergedOptions as any).__channelTrace)
        ? (mergedOptions as any).__channelTrace
        : [],
    },
    items: cappedItems,
    output: { format: params.taskPlan.outputSpec.format, content: formattedOutput },
    quality: evalResult.quality,
    status: evalResult.status,
    attempts: evalResult.attempt,
    retry: retryMeta,
    plan: (selectedState as any).plan ?? null,
    taskPlan: params.taskPlan,
    preflight: params.preflight,
    meta: {
      serp_fallback: Boolean((finalState as any)?.meta?.serp_fallback),
      seed_first: Boolean((mergedOptions as any).__seedFirstMode),
      manager_seed_count: Array.isArray((mergedOptions as any).__managerSeedUrls)
        ? (mergedOptions as any).__managerSeedUrls.length
        : 0,
      cloud_scrape_calls: Array.isArray((mergedOptions as any).__channelTrace)
        ? (mergedOptions as any).__channelTrace.filter((e: any) => e?.channel === 'mcp').length
        : 0,
      ...runCostToMeta((mergedOptions as any).__runCost),
    }
  }

  const outputPath = String((params.options as any)?.outputJsonPath ?? '').trim() || path.join(process.cwd(), 'crawler_results.json')
  try {
    await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8')
    params.emitLog('info', `Crawler：结果已保存为 JSON：${outputPath}`)
  } catch (e: any) {
    params.emitLog('warn', `Crawler：保存 JSON 失败：${e?.message || e}`)
  }

  return { ...result, outputPath }
}

