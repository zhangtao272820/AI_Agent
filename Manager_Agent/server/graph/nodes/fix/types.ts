import type { Intent } from '../../../utils/shared/taskPlan'

export type FixStrategy = {
  intent: Intent
  query: string
  rationale?: string
  skipAgents?: string[]
}

export type CreateFixNodeDeps = {
  ensureNotAborted: () => void
  opts: {
    runId: string
    threadId: string
    timeoutMs: number
    dbId?: string
    dbAgentWsUrl: string
    dbAgentHttpUrl: string
    ragAgentHttpUrl: string
    crawlerAgentWsUrl: string
    codeAgentWsUrl: string
    aiAdminAgentWsUrl: string
    signal?: AbortSignal
    sendEvent: (event: { event: string; data?: any; from?: string }) => void
  }
  lastUserText: (messages: any[]) => string
  llmInvoke: (stage: 'critic', state: any, messages: any[]) => Promise<{ text: string }>
  FixStrategySchema: any
  safeJsonParse: (text: string) => any
  callDbAgent: (input: any) => Promise<any>
  callRagAgent: (input: any) => Promise<any>
  callCrawlerAgent: (input: any) => Promise<any>
  callCodeAgent: (input: any) => Promise<any>
  callAiAdminAgent: (input: any) => Promise<any>
  parseCrawlerClarifyPayload: (raw: any) => { needsClarify: boolean; questions: string[] }
  crawlerTaskPlanPatch: (raw: any, fallbackQuery: string) => any
  mergeMeta: (state: any, patch: any) => any
  mergeTaskPlan: (base: any, incoming: any, fallbackIntent: Intent, fallbackSteps: any[]) => any
  getEffectivePlanSteps: (state: any) => any[]
  appendMetrics: (entry: any) => Promise<any>
  runInternalAgent: (kind: 'clean' | 'visualize' | 'report', question: string, state: any, contextInput?: any) => Promise<any>
  emitTrace: (entry: any) => void
  summarize: (text: string, max?: number) => string
  probeRagEvidence: (q: string) => Promise<any>
  isDbNoData: (text: string) => boolean
}
