export type CreateTurnScopeNodeDeps = {
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  lastUserText: (messages: BaseMessage[]) => string
  llmInvoke: LlmInvokeFn
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
}

