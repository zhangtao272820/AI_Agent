export type CreateVoteAggregatorNodeDeps = {
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  config?: {
    targets?: string[]
    factWeight?: number
    missingPenalty?: number
    lengthPenalty?: number
    evidenceSupportWeight?: number
    conflictPenalty?: number
  }
}

