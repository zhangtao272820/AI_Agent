export type CreateSecurityNodeDeps = {
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  lastUserText: (messages: any[]) => string
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
  llmInvoke?: LlmInvokeFn
}

