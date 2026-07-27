export type CreateMonitorNodeDeps = {
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
  appendMetrics: (entry: {
    runId: string
    phase: string
    ms: number
    tokens?: number
    usd?: number
    model?: string
    extra?: Record<string, any>
  }) => Promise<void>
}

