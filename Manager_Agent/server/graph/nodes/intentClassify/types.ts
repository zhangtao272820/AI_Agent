import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'

export type CreateIntentClassifyNodeDeps = {
  policyDir: string
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  sessionId?: string
  lastUserText: (messages: any[]) => string
  llmInvoke: LlmInvokeFn
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
}
