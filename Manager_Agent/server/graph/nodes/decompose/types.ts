export type CreateDecomposeNodeDeps = {
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  sessionId?: string
  runId?: string
  lastUserText: (messages: any[]) => string
  llmInvoke?: (
    stage: 'route' | 'plan' | 'synth' | 'critic',
    state: any,
    messages: any[]
  ) => Promise<{ text: string; resources: any; meta: any }>
  safeJsonParse: (text: string) => any
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
}
