import { useRuntimeConfig } from '#imports'
import { describeActiveModes } from '../utils/extractor_modes'
import { getExtractorAgentEnv } from '../utils/extractor_agent_env'
import { listPatchSummary } from '../services/patchRegistry'
import { getQueueStats } from '../services/crawlJobQueue'

export default defineEventHandler(() => {
  const cfg = useRuntimeConfig() as any
  const modes = describeActiveModes()
  const env = getExtractorAgentEnv()
  const qwenModel = String(cfg?.qwenModel ?? 'qwen3.5-flash')
  const qwenVlModel = String(cfg?.qwenVlModel ?? 'qwen-vl-plus')
  const cloudProvider = String(cfg?.mcp?.provider ?? '').trim()
  return {
    qwenModel,
    qwenVlModel,
    extractorMode: modes.extractorMode,
    modeLabel: modes.label,
    plannerMode: modes.plannerMode,
    agentMode: modes.agentMode,
    cloudScrape: {
      configured: Boolean(cloudProvider),
      provider: cloudProvider || null,
      label: cloudProvider ? `云抓取 (${cloudProvider})` : '未配置（仅 HTTP/浏览器）',
    },
    asyncQueue: {
      enabled: env.enableAsyncQueue,
      backend: env.queueBackend,
      redisUrl: env.queueBackend === 'redis' && env.redisUrl ? '(configured)' : null,
      maxConcurrent: env.queueMaxConcurrent,
      stats: getQueueStats(),
      submitPath: '/api/extract/async',
      pollPathPrefix: '/api/jobs/',
    },
    mcpServer: {
      enabled: env.enableMcpServer,
      endpoint: '/api/mcp',
      tools: ['scrape_url', 'extract_task'],
    },
    features: {
      learningStack: env.enableCrawlLearning || env.enableVectorExperience,
      failureLlm: env.enableFailureLlm,
      routePolicy: env.enableRoutePolicy,
      extractTemplates: env.enableExtractTemplates,
      metrics: env.enableCrawlMetrics,
      asyncQueue: env.enableAsyncQueue,
      mcpServer: env.enableMcpServer,
    },
    managerProtocol: {
      fields: ['seed_urls', 'serp_context', 'refined_task', 'preferred_channel', 'open_web_discovery'],
      seedFirst: true,
    },
    patches: listPatchSummary(),
    extractPaths: ['patch', 'template', 'rule', 'llm', 'heuristic', 'bing_serp', 'serp_fallback'],
    extractorModes: [
      { id: 'adaptive', label: '自适应（推荐）' },
      { id: 'fast', label: '快速' },
      { id: 'deep', label: '深度' },
    ],
    channelLabels: {
      http: 'HTTP 直连',
      browser: 'Playwright 浏览器',
      mcp: '云抓取（付费兜底）',
      skill: '站点技能（未启用）',
      unknown: '未知',
    },
    modelOptions: [
      { id: 'qwen3.5-flash', label: 'qwen3.5-flash' },
      { id: 'qwen-plus', label: 'qwen-plus' },
      { id: 'qwen-plus-2025-07-28', label: 'qwen-plus-2025-07-28' },
      { id: qwenModel, label: `${qwenModel}（当前）` },
    ].filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i),
  }
})
