import type { LlmInvokeOptions } from '../../core/shared/modelTier'

export type CreateFinalNodesDeps = {
  ensureNotAborted: () => void
  opts: any
  llmInvoke: (
    stage: 'synth' | 'critic' | 'verifier',
    state: any,
    messages: any[],
    options?: LlmInvokeOptions
  ) => Promise<any>
  lastUserText: (messages: any[]) => string
  runAlwaysInternalCollaborators: (state: any, question: string, resultsIn: Record<string, string>, evidenceIn: any[]) => Promise<any>
  extractStructuredPayload: (raw: string) => any
  sanitizeUntrustedText: (text: string) => string
  formatReferences: (evidence: any[]) => string
  stripLatexMath: (text: string) => string
  summarize: (text: string, max?: number) => string
  mergeMeta: (state: any, patch: any) => any
  getEffectivePlanSteps: (state: any) => any[]
  timeLeftMs: (resources: any) => number
  policyPromise: Promise<any>
  defaultPolicy: () => any
  appendMemory: (entry: any) => Promise<any>
  appendNluMetrics: (entry: any) => Promise<any>
  maybeUpdateManagerPolicy: (dir: string) => Promise<any>
  policyDir: string
  readFeedbackForRun: (dir: string, runId: string) => Promise<any>
  clampNumber: (n: any, min: number, max: number) => number
  deriveScenarioKey: (text: string) => string
  uncertaintyFromConfidence: (conf?: number) => 'low' | 'medium' | 'high'
  normalizeFinalUserText: (text: string) => string
  redactSecrets: (text: string) => string
  safeJsonParse: (text: string) => any
  IntentSchema: any
}
