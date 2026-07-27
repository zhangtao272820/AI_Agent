import { runCrawlerAgent } from '../services/crawlerAgent'
import type { AgentConfig, CrawlerAgentOptions, EmitEvent } from '../services/crawlerAgentTypes'
import {
  applyExtractorModeOverride,
  applyExtractorModesToConfig,
  describeModesFromConfig,
} from './extractor_modes'
import { attachClarifySuggestions } from './clarification_hints'
import { mergeFollowupTaskWithHistory, type TaskTurn } from './task_condense'
import { applyManagerTaskHints, sanitizeIncomingTask } from './incoming_task'
import { getExtractorAgentEnv } from './extractor_agent_env'
import { buildExtractRunMeta, recordCrawlMetric, setRunMeta } from './crawl_metrics'
import { recordRunLearningSignal } from './crawl_learning'
import { buildRouteContextKey, recordChannelOutcomeFromRun } from './crawl_route_policy'
import { inferFailureTagsFromRunAsync } from './crawl_failure_tags'
import { recordExtractTemplate } from './crawl_extract_templates'
import { buildCrawlInjectBlocksAsync, buildExperienceHint, recordCrawlExperience, resolveExperienceRoutingHint } from './crawl_experience'
import { createQwenChatModel } from '../services/crawlerAgentFrontload'
import { maybeReflectAfterRun } from './crawl_reflect'
import { appendPromptPatch } from './prompt_evolution'
import { runLightweightCuratorOnCrawlEnd } from './learning_curator'
import { learnFromSuccessfulCrawl } from './user_preferences'
import { indexCrawlExperienceVector } from './experience_vectors'
import { ensureRunCost, runCostToMeta } from './runCost'
import { buildExtractorMemoryFacts } from './manager_memory_bridge'
import {
  isExtractorWebSearchEnabled,
  isNetworkRequested,
  managerTaskAlreadyHasSeeds,
  resolveExtractorUiNetworkBootstrap,
} from './extractor_web_search'

export type ExecuteExtractParams = {
  task: string
  options?: CrawlerAgentOptions
  config: AgentConfig
  signal: AbortSignal
  emit?: (evt: EmitEvent) => void
  manager_task_json?: string
  managerTask?: Record<string, unknown>
  session_id?: string
  source?: string
  history?: TaskTurn[]
  /** 独立 UI「+联网」；默认 true（直连也尽量先搜种子） */
  network?: boolean
}

export async function executeExtractRun(params: ExecuteExtractParams) {
  const env = getExtractorAgentEnv()
  const rawTask = String(params.task ?? '').trim()
  if (!rawTask) throw new Error('task 不能为空')

  let managerRaw =
    params.manager_task_json?.trim() ||
    (params.managerTask && typeof params.managerTask === 'object' ? JSON.stringify(params.managerTask) : '')

  const emit = params.emit ?? (() => {})
  const networkOn = isNetworkRequested(
    params.options as Record<string, unknown> | null | undefined,
    params.network
  )

  // 独立 UI / 直连：无 Manager 种子且开启联网 → 站点锁官方种子，否则 SERP（已剔教程站）
  if (
    networkOn &&
    isExtractorWebSearchEnabled() &&
    !managerTaskAlreadyHasSeeds(managerRaw) &&
    (params.source === 'ws' || params.source === 'http' || params.source === 'extractor_ui' || !params.source)
  ) {
    emit({ type: 'log', payload: { level: 'info', message: '联网引导：解析目标站 / 检索种子…', ts: Date.now() } } as EmitEvent)
    const boot = await resolveExtractorUiNetworkBootstrap(rawTask)
    if (boot.managerJson) {
      managerRaw = boot.managerJson
      emit({
        type: 'log',
        payload: {
          level: 'info',
          message: `联网引导（${boot.mode}）：${boot.detail}`,
          ts: Date.now(),
        },
      } as EmitEvent)
    } else {
      emit({
        type: 'log',
        payload: {
          level: 'warn',
          message: `联网引导未获可用种子（${boot.detail}），将回退站点能力档案 / 开放发现`,
          ts: Date.now(),
        },
      } as EmitEvent)
    }
  }

  let config = applyExtractorModesToConfig(params.config)
  const reqExtractorMode = String((params.options as any)?.extractor_mode ?? '').trim()
  if (reqExtractorMode) config = applyExtractorModeOverride(config, reqExtractorMode)
  const reqQwenModel = String((params.options as any)?.qwen_model ?? '').trim()
  if (reqQwenModel) config = { ...config, qwenModel: reqQwenModel }

  const condensed = await mergeFollowupTaskWithHistory(rawTask, params.history, createQwenChatModel(config))
  const sanitized = sanitizeIncomingTask(condensed)
  const hinted = applyManagerTaskHints(sanitized, managerRaw || null)
  const modes = describeModesFromConfig(config)
  const options: CrawlerAgentOptions = {
    robotsPolicy: env.robotsPolicy,
    maxItems: env.maxItemsDefault,
    maxPages: env.maxPagesDefault,
    maxConcurrency: env.maxConcurrencyDefault,
    ...params.options,
    ...hinted.options,
  }
  if (params.session_id) (options as any).session_id = params.session_id
  if ((hinted.options as any)?.preferred_channel) {
    (options as any).preferred_channel = (hinted.options as any).preferred_channel
  }
  if ((options as any).preferred_channel === 'mcp' || (hinted.options as any)?.__preferMcp) {
    (options as any).__preferMcp = true
  }
  // 独立 UI 明确 http/browser 时禁止经验路由再顶成 MCP，避免教程站拖死 Firecrawl
  if ((options as any).preferred_channel === 'http' || (options as any).preferred_channel === 'browser') {
    ;(options as any).__preferMcp = false
  }
  if (!Number.isFinite(Number((options as any).__mcpMaxCalls))) {
    (options as any).__mcpMaxCalls = env.mcpMaxCallsDefault
  }
  const managerSeedCount = Array.isArray((options as any).__managerSeedUrls)
    ? (options as any).__managerSeedUrls.length
    : 0
  if (managerSeedCount > 3) {
    ;(options as any).__mcpMaxCalls = Math.max(
      Number((options as any).__mcpMaxCalls ?? env.mcpMaxCallsDefault),
      Math.min(12, managerSeedCount + 2),
    )
  }
  const sessionKey = params.session_id || String((options as any).session_id ?? '').trim() || undefined
  const embeddingConfig = {
    apiKey: String(config?.qwenApiKey ?? ''),
    baseUrl: String(config?.qwenBaseUrl ?? env.qwenBaseUrl),
    model: env.embeddingModel,
  }
  ;(options as any).__rawTaskForTemplates = hinted.task
  ;(options as any).__injectBlocks = await buildCrawlInjectBlocksAsync(hinted.task, sessionKey, embeddingConfig)
  const routeHint = resolveExperienceRoutingHint(hinted.task)
  if (routeHint?.preferred_channel && !(options as any).preferred_channel) {
    ;(options as any).preferred_channel = routeHint.preferred_channel
    if (routeHint.preferred_channel === 'mcp') (options as any).__preferMcp = true
    if (routeHint.preferred_channel === 'browser') options.useBrowser = true
  }
  if (
    routeHint?.seed_url &&
    !Array.isArray((options as any).__managerSeedUrls) &&
    !(options as any).__seedFirstMode
  ) {
    ;(options as any).__experienceSeedUrl = routeHint.seed_url
  }

  ensureRunCost(options as Record<string, unknown>)
  const t0 = Date.now()
  const result = await runCrawlerAgent({
    task: hinted.task,
    options,
    config,
    signal: params.signal,
    emit,
  })

  const enriched = attachClarifySuggestions(result)
  const model = createQwenChatModel(config)
  const failureTags = await inferFailureTagsFromRunAsync(enriched, model)
  const routeContextKey = buildRouteContextKey({
    targetSite: enriched?.taskPlan?.targetSite,
    contentType: enriched?.taskPlan?.contentType,
    antiBotRisk: enriched?.preflight?.antiBotRisk,
  })
  const meta = {
    ...buildExtractRunMeta(enriched),
    ...runCostToMeta(ensureRunCost(options as Record<string, unknown>)),
    ...(enriched?.meta &&
    typeof enriched.meta === 'object' &&
    (enriched.meta as { serp_fallback?: boolean }).serp_fallback
      ? { serp_fallback: true }
      : {}),
    extractor_mode: modes.extractorMode,
    planner_mode: modes.plannerMode,
    agent_mode: modes.agentMode,
    mode_label: modes.label,
    route_context_key: routeContextKey,
    failure_tags: failureTags,
    session_id: sessionKey,
  }
  const withMeta = { ...enriched, meta }
  setRunMeta(meta)

  const reflectHint = await maybeReflectAfterRun(model, hinted.task, withMeta)
  if (reflectHint) {
    withMeta.meta = { ...withMeta.meta, reflect_hint: reflectHint }
    setRunMeta(withMeta.meta)
  }

  const ms = Date.now() - t0
  if (env.enableCrawlMetrics) {
    const status = String(result?.status ?? '')
    const items = Array.isArray(result?.items) ? result.items : []
    recordCrawlMetric({
      target_site: meta.target_site,
      content_type: meta.content_type,
      channel: meta.primary_channel,
      ok: status === 'ok' || status === 'partial_ok',
      empty: items.length === 0 && status !== 'needs_clarification',
      quality_passed: meta.quality_passed,
      retry_triggered: meta.retry_triggered,
      ms,
      task: hinted.task.slice(0, 200),
      status,
    })
  }

  recordRunLearningSignal({
    task: hinted.task,
    result: withMeta,
    ms,
    source: params.source,
  })

  recordChannelOutcomeFromRun(withMeta, ms)

  const status = String(withMeta?.status ?? '')
  const items = Array.isArray(withMeta?.items) ? withMeta.items : []
  if ((status === 'ok' || status === 'partial_ok') && items.length > 0) {
    const tp = withMeta.taskPlan ?? {}
    const plan = (withMeta as any).plan ?? {}
    const seedUrl =
      String((withMeta as any)?.plan?.seedUrls?.[0] ?? '').trim() ||
      String(withMeta?.stats?._routeLog?.[0]?.url ?? '').trim()
    recordExtractTemplate({
      task: hinted.task,
      target_site: tp.targetSite,
      content_type: tp.contentType,
      seed_url: seedUrl,
      fields: tp.fields,
      channel: meta.primary_channel,
      entity: (withMeta as any)?.plan?.extraction?.entity,
      item_count: items.length,
    })
    recordCrawlExperience({
      task: hinted.task,
      target_site: tp.targetSite,
      content_type: tp.contentType,
      channel: meta.primary_channel,
      seed_url: seedUrl,
      fields: tp.fields,
    })
    const expHint = buildExperienceHint({
      target_site: tp.targetSite,
      content_type: tp.contentType,
      channel: meta.primary_channel,
      seed_url: seedUrl,
      fields: tp.fields,
    })
    await indexCrawlExperienceVector({
      task: hinted.task,
      hint: expHint,
      target_site: tp.targetSite,
      content_type: tp.contentType,
      channel: meta.primary_channel,
      embeddingConfig,
    })
    learnFromSuccessfulCrawl({
      sessionKey,
      task: hinted.task,
      target_site: tp.targetSite,
      content_type: tp.contentType,
      limit: tp.limit ?? plan?.maxItems,
      fields: tp.fields,
      channel: meta.primary_channel,
      output_format: tp.outputSpec?.format,
    })
    const memoryFacts = buildExtractorMemoryFacts({
      task: hinted.task,
      target_site: tp.targetSite,
      content_type: tp.contentType,
      channel: meta.primary_channel,
      item_count: items.length,
      seed_url: seedUrl,
      fields: tp.fields,
    })
    if (memoryFacts.length) {
      withMeta.meta = { ...withMeta.meta, memory_facts: memoryFacts }
      setRunMeta(withMeta.meta)
    }
  } else if (items.length === 0 && env.enablePromptEvolution) {
    appendPromptPatch({
      stage: 'plan',
      text: `空结果：优先核对种子 URL 与通道（当前 ${meta.primary_channel ?? 'unknown'}）`,
      source: 'empty_result',
    })
  }

  runLightweightCuratorOnCrawlEnd()

  return withMeta
}
