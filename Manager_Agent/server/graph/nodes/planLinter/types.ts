import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'

export type CreatePlanLinterNodeDeps = {
  ensureNotAborted: () => void
  policyDir: string
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  getEffectivePlanSteps: (state: any) => any[]
  lastUserText: (messages: any[]) => string
  llmInvoke: LlmInvokeFn
  buildClarifyQuestions: (
    question: string,
    intent: any,
    probe: any,
    options?: { planIssues?: string[]; entityNames?: string[] }
  ) => string[]
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
}
