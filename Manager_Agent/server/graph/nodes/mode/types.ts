export type CreateExecutionModeNodeDeps = {
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  getEffectivePlanSteps: (state: any) => Step[]
  modeOverride?: string
  voteTargetsOverride?: string[]
}

