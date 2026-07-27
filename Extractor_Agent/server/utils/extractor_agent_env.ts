/**
 * Extractor Agent 运行时常量；行为参数可通过 .env 覆盖。
 */

function parseEnvBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]
  if (v == null || String(v).trim() === '') return fallback
  return /^(1|true|yes|on)$/i.test(String(v).trim())
}

function parseEnvInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name])
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function parseEnvFloat(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name])
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

export const EXTRACTOR_AGENT_DEFAULTS = {
  plannerMode: 'auto' as 'auto' | 'llm' | 'heuristic',
  agentMode: 'smart' as 'smart' | 'llm' | 'rules',
  qwenBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  qwenModel: 'qwen3.5-flash',
  qwenVlModel: 'qwen-vl-plus',
  qwenEnableThinking: false,
  robotsPolicy: 'strict' as 'strict' | 'warn' | 'off',
  maxItemsDefault: 10,
  maxPagesDefault: 1,
  maxConcurrencyDefault: 3,
  /** §14③：同域请求最小间隔（ms），与 robots crawl-delay 取 max */
  domainPoliteDelayMs: 1200,
  /** P3：学习栈默认关闭；设 EXTRACTOR_LEARNING=1 或逐项 EXTRACTOR_ENABLE_* 开启 */
  enableCrawlLearning: false,
  enableCrawlMetrics: true,
  enableRoutePolicy: true,
  enableExtractTemplates: true,
  enableExperienceReplay: false,
  enablePromptEvolution: false,
  enableFailureReflect: false,
  enableAutoCurateOnQuery: false,
  enableUserPreferences: false,
  enableVectorExperience: false,
  enableManagerMemoryBridge: false,
  enableFailureLlm: true,
  embeddingModel: 'text-embedding-v1',
  vectorExperienceMinScore: 0.72,
  vectorExperienceMaxEntries: 200,
  embeddingMaxInputChars: 96,
  embeddingQueryCacheTtlSec: 600,
  vectorIndexMinTaskChars: 6,
  vectorRecallOnlyWhenNgramWeak: true,
  experienceBlockMaxChars: 420,
  promptPromoteMinHits: 3,
  routeBanditMinTrials: 2,
  metricsRecentLimit: 50,
  learningSignalsMaxRead: 600,
  taskMaxChars: 2000,
  /** P4：进程内并发闸门 + 异步 job（无需 Redis） */
  enableAsyncQueue: true,
  /** P4-2b：local | redis（redis 需 REDIS_URL，仅 async job 跨实例） */
  queueBackend: 'local' as 'local' | 'redis',
  redisUrl: '',
  /** P4：JSON-RPC MCP Server（/api/mcp） */
  enableMcpServer: false,
  queueMaxConcurrent: 3,
  /** 单次任务云抓取（MCP）最大调用次数，与 seed 队列上限对齐 */
  mcpMaxCallsDefault: 6,
} as const

export type ExtractorAgentEnv = {
  plannerMode: 'auto' | 'llm' | 'heuristic'
  agentMode: 'smart' | 'llm' | 'rules'
  qwenBaseUrl: string
  qwenModel: string
  qwenVlModel: string
  qwenEnableThinking: boolean
  robotsPolicy: 'strict' | 'warn' | 'off'
  maxItemsDefault: number
  maxPagesDefault: number
  maxConcurrencyDefault: number
  domainPoliteDelayMs: number
  enableCrawlLearning: boolean
  enableCrawlMetrics: boolean
  enableRoutePolicy: boolean
  enableExtractTemplates: boolean
  enableExperienceReplay: boolean
  enablePromptEvolution: boolean
  enableFailureReflect: boolean
  enableAutoCurateOnQuery: boolean
  enableUserPreferences: boolean
  enableVectorExperience: boolean
  enableManagerMemoryBridge: boolean
  enableFailureLlm: boolean
  embeddingModel: string
  vectorExperienceMinScore: number
  vectorExperienceMaxEntries: number
  embeddingMaxInputChars: number
  embeddingQueryCacheTtlSec: number
  vectorIndexMinTaskChars: number
  vectorRecallOnlyWhenNgramWeak: boolean
  experienceBlockMaxChars: number
  promptPromoteMinHits: number
  routeBanditMinTrials: number
  metricsRecentLimit: number
  learningSignalsMaxRead: number
  taskMaxChars: number
  enableAsyncQueue: boolean
  enableMcpServer: boolean
  queueBackend: 'local' | 'redis'
  redisUrl: string
  queueMaxConcurrent: number
  mcpMaxCallsDefault: number
}

let cached: { at: number; env: ExtractorAgentEnv } | null = null

export function getExtractorAgentEnv(): ExtractorAgentEnv {
  const now = Date.now()
  if (cached && now - cached.at < 5_000) return cached.env
  const d = EXTRACTOR_AGENT_DEFAULTS
  const learningMaster = (() => {
    const mode = String(process.env.EXTRACTOR_LEARNING_MODE ?? '').trim().toLowerCase()
    if (mode === 'convergence' || mode === 'learning' || mode === 'on') return true
    if (mode === 'off' || mode === '0' || mode === 'false') return false
    return parseEnvBool('EXTRACTOR_LEARNING', false)
  })()
  const learningOn = (name: string, fallback: boolean) =>
    parseEnvBool(name, learningMaster ? true : fallback)
  const env: ExtractorAgentEnv = {
    plannerMode: (String(process.env.PLANNER_MODE || d.plannerMode).toLowerCase() as ExtractorAgentEnv['plannerMode']) || d.plannerMode,
    agentMode: (String(process.env.AGENT_MODE || d.agentMode).toLowerCase() as ExtractorAgentEnv['agentMode']) || d.agentMode,
    qwenBaseUrl: String(process.env.QWEN_BASE_URL || d.qwenBaseUrl).trim() || d.qwenBaseUrl,
    qwenModel: String(process.env.QWEN_MODEL || d.qwenModel).trim() || d.qwenModel,
    qwenVlModel: String(process.env.QWEN_VL_MODEL || d.qwenVlModel).trim() || d.qwenVlModel,
    qwenEnableThinking: parseEnvBool('QWEN_ENABLE_THINKING', d.qwenEnableThinking),
    robotsPolicy: (['strict', 'warn', 'off'].includes(String(process.env.CRAWLER_ROBOTS_POLICY || d.robotsPolicy).toLowerCase())
      ? String(process.env.CRAWLER_ROBOTS_POLICY || d.robotsPolicy).toLowerCase()
      : d.robotsPolicy) as ExtractorAgentEnv['robotsPolicy'],
    maxItemsDefault: parseEnvInt('CRAWLER_MAX_ITEMS', d.maxItemsDefault, 1, 250),
    maxPagesDefault: parseEnvInt('CRAWLER_MAX_PAGES', d.maxPagesDefault, 1, 50),
    maxConcurrencyDefault: parseEnvInt('CRAWLER_MAX_CONCURRENCY', d.maxConcurrencyDefault, 1, 10),
    domainPoliteDelayMs: parseEnvInt('EXTRACTOR_DOMAIN_POLITE_DELAY_MS', d.domainPoliteDelayMs, 0, 30_000),
    enableCrawlLearning: learningOn('EXTRACTOR_ENABLE_LEARNING', d.enableCrawlLearning),
    enableCrawlMetrics: parseEnvBool('EXTRACTOR_ENABLE_METRICS', d.enableCrawlMetrics),
    enableRoutePolicy: parseEnvBool('EXTRACTOR_ENABLE_ROUTE_POLICY', d.enableRoutePolicy),
    enableExtractTemplates: parseEnvBool('EXTRACTOR_ENABLE_EXTRACT_TEMPLATES', d.enableExtractTemplates),
    enableExperienceReplay: learningOn('EXTRACTOR_ENABLE_EXPERIENCE_REPLAY', d.enableExperienceReplay),
    enablePromptEvolution: learningOn('EXTRACTOR_ENABLE_PROMPT_EVOLUTION', d.enablePromptEvolution),
    enableFailureReflect: learningOn('EXTRACTOR_ENABLE_FAILURE_REFLECT', d.enableFailureReflect),
    enableAutoCurateOnQuery: learningOn('EXTRACTOR_ENABLE_AUTO_CURATE', d.enableAutoCurateOnQuery),
    enableUserPreferences: learningOn('EXTRACTOR_ENABLE_USER_PREFERENCES', d.enableUserPreferences),
    enableVectorExperience: learningOn('EXTRACTOR_ENABLE_VECTOR_EXPERIENCE', d.enableVectorExperience),
    enableManagerMemoryBridge: learningOn('EXTRACTOR_ENABLE_MANAGER_MEMORY_BRIDGE', d.enableManagerMemoryBridge),
    enableFailureLlm: parseEnvBool('EXTRACTOR_FAILURE_LLM', d.enableFailureLlm),
    embeddingModel: String(process.env.EXTRACTOR_EMBEDDING_MODEL || d.embeddingModel).trim() || d.embeddingModel,
    vectorExperienceMinScore: parseEnvFloat('EXTRACTOR_VECTOR_MIN_SCORE', d.vectorExperienceMinScore, 0.5, 0.95),
    vectorExperienceMaxEntries: parseEnvInt('EXTRACTOR_VECTOR_MAX_ENTRIES', d.vectorExperienceMaxEntries, 50, 500),
    embeddingMaxInputChars: parseEnvInt('EXTRACTOR_EMBEDDING_MAX_CHARS', d.embeddingMaxInputChars, 32, 256),
    embeddingQueryCacheTtlSec: parseEnvInt('EXTRACTOR_EMBEDDING_CACHE_TTL_SEC', d.embeddingQueryCacheTtlSec, 60, 3600),
    vectorIndexMinTaskChars: parseEnvInt('EXTRACTOR_VECTOR_MIN_TASK_CHARS', d.vectorIndexMinTaskChars, 4, 40),
    vectorRecallOnlyWhenNgramWeak: parseEnvBool('EXTRACTOR_VECTOR_RECALL_WHEN_NGRAM_WEAK', d.vectorRecallOnlyWhenNgramWeak),
    experienceBlockMaxChars: parseEnvInt('EXTRACTOR_EXPERIENCE_BLOCK_MAX_CHARS', d.experienceBlockMaxChars, 200, 800),
    promptPromoteMinHits: parseEnvInt('EXTRACTOR_PROMPT_PROMOTE_MIN_HITS', d.promptPromoteMinHits, 2, 10),
    routeBanditMinTrials: parseEnvInt('EXTRACTOR_ROUTE_BANDIT_MIN_TRIALS', d.routeBanditMinTrials, 1, 10),
    metricsRecentLimit: parseEnvInt('EXTRACTOR_METRICS_RECENT', d.metricsRecentLimit, 10, 200),
    learningSignalsMaxRead: parseEnvInt('EXTRACTOR_LEARNING_MAX_READ', d.learningSignalsMaxRead, 100, 2000),
    taskMaxChars: parseEnvInt('EXTRACTOR_TASK_MAX_CHARS', d.taskMaxChars, 200, 8000),
    enableAsyncQueue: parseEnvBool('EXTRACTOR_ASYNC_QUEUE', d.enableAsyncQueue),
    enableMcpServer: parseEnvBool('EXTRACTOR_MCP_SERVER', d.enableMcpServer),
    queueBackend: (String(process.env.EXTRACTOR_QUEUE_BACKEND || d.queueBackend).toLowerCase() === 'redis'
      ? 'redis'
      : 'local') as ExtractorAgentEnv['queueBackend'],
    redisUrl: String(process.env.REDIS_URL || process.env.EXTRACTOR_REDIS_URL || d.redisUrl).trim(),
    queueMaxConcurrent: parseEnvInt(
      'EXTRACTOR_QUEUE_MAX_CONCURRENT',
      parseEnvInt('CRAWLER_MAX_CONCURRENCY', d.queueMaxConcurrent, 1, 10),
      1,
      20,
    ),
    mcpMaxCallsDefault: parseEnvInt('EXTRACTOR_MCP_MAX_CALLS', d.mcpMaxCallsDefault, 0, 24),
  }
  cached = { at: now, env }
  return env
}
