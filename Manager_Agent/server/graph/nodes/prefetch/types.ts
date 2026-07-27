export type CreatePrefetchNodeDeps = {
  opts: {
    sendEvent: (event: { event: string; data?: any; from?: string }) => void
    runId?: string
    dbAgentHttpUrl?: string
    ragAgentHttpUrl?: string
    dbId?: string
    userId?: string
    timeoutMs?: number
  }
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
  appendMetrics?: (entry: {
    runId: string
    phase: string
    ms: number
    extra?: Record<string, unknown>
  }) => Promise<void>
}
