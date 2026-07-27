export type StepDecideObservation = {
  url: string
  title: string
  stageHint: string
  candidatesTopK: Array<{
    i: number
    cid?: string
    kind?: string
    label?: string
    placeholder?: string
    href?: string
    score?: number
  }>
  lastAction?: string
  lastError?: string
  pageTextSnippet?: string
  recentFailures?: string[]
}

export type StepDecideTaskSpec = {
  goals?: Record<string, unknown>
  allowedIntents?: string[]
  forbiddenIntents?: string[]
  intentsOrder?: string[]
  summary?: Record<string, unknown>
  successCriteria?: Record<string, unknown>
  completionCriteria?: Record<string, unknown>
}
