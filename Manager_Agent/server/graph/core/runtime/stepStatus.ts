/** E3：统一 multi 步骤状态事件 */

export type StepStatusValue = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export type StepStatusPayload = {
  stepId: string
  agent: string
  status: StepStatusValue
  query?: string
  error?: string
  pct?: number
  eta_ms?: number
  trace_id?: string
}

export function buildStepStatus(
  input: Pick<StepStatusPayload, 'stepId' | 'agent' | 'status'> & Partial<StepStatusPayload>,
  runId?: string
): StepStatusPayload {
  const trace_id = input.trace_id || (runId ? String(runId).trim() : undefined)
  const out: StepStatusPayload = {
    stepId: input.stepId,
    agent: input.agent,
    status: input.status
  }
  if (input.query) out.query = input.query
  if (input.error) out.error = input.error
  if (typeof input.pct === 'number' && Number.isFinite(input.pct)) out.pct = Math.max(0, Math.min(100, Math.round(input.pct)))
  if (typeof input.eta_ms === 'number' && Number.isFinite(input.eta_ms)) out.eta_ms = Math.max(0, Math.round(input.eta_ms))
  if (trace_id) out.trace_id = trace_id
  return out
}

/** 粗估 multi 剩余耗时（毫秒），供 UI ETA */
export function estimateMultiEtaMs(input: {
  totalSteps: number
  completedSteps: number
  maxParallel: number
  timeoutScale?: number
}) {
  const total = Math.max(1, input.totalSteps)
  const done = Math.max(0, Math.min(total, input.completedSteps))
  const remaining = Math.max(0, total - done)
  const parallel = Math.max(1, input.maxParallel)
  const scale = Number.isFinite(input.timeoutScale) ? Math.max(0.8, Math.min(1.8, input.timeoutScale!)) : 1
  const batches = Math.ceil(remaining / parallel)
  return Math.round(batches * 22_000 * scale)
}
