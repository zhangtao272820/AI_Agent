export type CrawlerAgentOptions = {
  maxPages?: number
  maxItems?: number
  delayMinMs?: number
  delayMaxMs?: number
  useBrowser?: boolean
  maxConcurrency?: number // For distributed crawling
  headless?: boolean
  proxyFilePath?: string
  outputJsonPath?: string
  resumeId?: string
  checkpointIntervalMs?: number
  rateLimit?: {
    tokensPerInterval?: number
    intervalMs?: number
    backoffBaseMs?: number
    backoffMaxMs?: number
    perHostOverrides?: Record<string, { tokensPerInterval?: number; intervalMs?: number }>
  }
  robotsPolicy?: 'strict' | 'warn' | 'off'
}

export type AgentConfig = {
  qwenApiKey?: string
  qwenBaseUrl?: string
  qwenModel?: string
  qwenVlModel?: string
  qwenEnableThinking?: boolean
  plannerMode?: 'auto' | 'llm' | 'heuristic'
  agentMode?: 'smart' | 'llm' | 'rules'
  extractorMode?: 'adaptive' | 'fast' | 'deep'
  crawler?: { userAgent?: string; proxyFilePath?: string }
  mcp?: {
    provider?: 'scrapingant' | 'zenrows' | 'scraperapi' | 'generic'
    apiKey?: string
    baseUrl?: string
    queryParamKey?: string
    headerKey?: string
    render?: boolean
    country?: string
  }
  skills?: Array<{
    host?: string
    includes?: string
    urlTemplate: string
    tokenHeader?: string
    token?: string
  }>
}

export type EmitEvent =
  | { type: 'log'; payload: { level: 'info' | 'warn' | 'error'; message: string; ts: number } }
  | { type: 'progress'; payload: { stage: string; done?: number; total?: number } }

export type RunParams = {
  task: string
  options?: CrawlerAgentOptions
  config: AgentConfig
  signal: AbortSignal
  emit: (evt: EmitEvent) => void
}

