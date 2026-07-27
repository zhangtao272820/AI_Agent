export type CreateOptimizerNodeDeps = {
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
}

