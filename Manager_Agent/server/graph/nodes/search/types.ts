import { ChatOpenAI } from '@langchain/openai'

export type CreateWebSearchNodeDeps = {
  opts: {
    sendEvent: (event: { event: string; data?: any; from?: string }) => void
    openaiApiKey?: string
    openaiBaseUrl?: string
    openaiModel?: string
    runId?: string
  }
  lastUserText: (messages: any[]) => string
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
  mergeResources?: (state: any, patch: Record<string, any>) => Record<string, any>
  appendMetrics?: (entry: {
    runId: string
    phase: string
    ms: number
    extra?: Record<string, unknown>
  }) => Promise<void>
}
