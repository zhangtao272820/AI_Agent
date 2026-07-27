import type { LobsterEngineId } from './engineSelector'

export type LobsterRunOutput = {
  traceId?: string
  traceZipPath?: string
  task: string
  plan?: unknown
  finalUrl?: string
  engine: LobsterEngineId
  executionEngine?: LobsterEngineId
  failureType?: string
  confirmCount?: number
  stats?: Record<string, unknown>
  data?: unknown[]
  answer?: string
  replay?: unknown[]
  [key: string]: unknown
}

export function wrapLobsterOutput(
  base: Record<string, unknown>,
  engine: LobsterEngineId,
  extras?: { failureType?: string; confirmCount?: number; answer?: string }
): LobsterRunOutput {
  const stats =
    base.stats && typeof base.stats === 'object' ? (base.stats as Record<string, unknown>) : {}
  const answer =
    String(extras?.answer ?? base.answer ?? '').trim() ||
    (Array.isArray(base.data) && base.data.length
      ? JSON.stringify(base.data.slice(-1)[0]).slice(0, 2000)
      : '')
  return {
    ...base,
    engine,
    executionEngine: engine,
    failureType: String(extras?.failureType ?? base.failureType ?? '').trim() || undefined,
    confirmCount: Number(extras?.confirmCount ?? base.confirmCount ?? 0) || undefined,
    answer: answer || undefined,
    stats
  }
}
