export type CreateResourceNodeDeps = {
  opts: {
    sendEvent: (event: { event: string; data?: any; from?: string }) => void
    timeoutMs: number
    openaiModel: string
    llmProfile?: {
      modelRoute?: string
      modelRouteMax?: string
      modelPlan?: string
      modelSynth?: string
      modelCritic?: string
      modelVerifier?: string
      modelLowCost?: string
    }
  }
  readEnvNumber: (key: string, fallback?: number) => number | undefined
  mergeResources: (state: any, patch: Record<string, any>) => Record<string, any>
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
}

