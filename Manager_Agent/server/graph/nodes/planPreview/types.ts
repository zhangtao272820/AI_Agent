export type PlanPreviewNodeDeps = {
  ensureNotAborted: () => void
  opts: {
    runId: string
    sendEvent: (event: { event: string; data?: unknown; from?: string }) => void
  }
  mergeMeta: (state: any, patch: Record<string, unknown>) => Record<string, unknown>
}

