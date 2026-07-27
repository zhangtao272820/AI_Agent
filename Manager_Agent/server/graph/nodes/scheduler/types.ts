export type CreateSchedulerNodeDeps = {
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  getEffectivePlanSteps: (state: any) => Step[]
}

