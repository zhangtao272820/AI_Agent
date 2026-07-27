/** LLM 速度/超时：保证 Agent 必须走模型时有足够预算，避免 deadline 误杀 */

export function managerLlmHttpTimeoutMs(): number {
  const n = Number(process.env.MANAGER_LLM_REQUEST_TIMEOUT_MS ?? 120_000)
  return Number.isFinite(n) && n >= 15_000 ? Math.min(180_000, Math.floor(n)) : 120_000
}

export function managerLlmMaxRetries(): number {
  const n = Number(process.env.MANAGER_LLM_MAX_RETRIES ?? 0)
  return Number.isFinite(n) && n >= 0 ? Math.min(2, Math.floor(n)) : 0
}

export function internalAgentTimeoutBaseMs(): number {
  const n = Number(process.env.MANAGER_INTERNAL_AGENT_TIMEOUT_MS ?? 45_000)
  return Number.isFinite(n) && n >= 10_000 ? Math.min(120_000, Math.floor(n)) : 45_000
}

export function internalAgentTimeoutMaxMs(): number {
  const n = Number(process.env.MANAGER_INTERNAL_AGENT_TIMEOUT_MAX_MS ?? 90_000)
  return Number.isFinite(n) && n >= 20_000 ? Math.min(180_000, Math.floor(n)) : 90_000
}

export function internalDeadlineReserveMs(): number {
  const n = Number(process.env.MANAGER_INTERNAL_DEADLINE_RESERVE_MS ?? 50_000)
  return Number.isFinite(n) && n >= 15_000 ? Math.min(120_000, Math.floor(n)) : 50_000
}

/**
 * 内置 clean/visualize/report：优先保证 LLM 完成预算，不因全局 deadline 过近压到 10s。
 */
export function resolveInternalAgentTimeoutMs(
  timeLeftMs: (resources: unknown) => number,
  resources: unknown,
  timeoutScale: number
): number {
  const base = internalAgentTimeoutBaseMs()
  const maxCap = internalAgentTimeoutMaxMs()
  const scale = Number.isFinite(timeoutScale) ? Math.max(0.85, Math.min(1.5, timeoutScale)) : 1
  const preferred = Math.round(base * scale)
  const left = timeLeftMs(resources)

  if (left <= 0) return Math.min(maxCap, preferred)
  if (left < 8_000) return Math.min(maxCap, Math.max(5_000, left - 1_000))
  return Math.min(maxCap, preferred, left - 2_000)
}

/** deadline 不足时为协作 LLM 续展，避免 internal clean/report 被 10s 误杀 */
export function extendResourcesDeadlineIfNeeded(
  resources: Record<string, unknown>,
  timeLeftMs: (resources: unknown) => number,
  reserveMs?: number
): Record<string, unknown> {
  const reserve = reserveMs ?? internalDeadlineReserveMs()
  const left = timeLeftMs(resources)
  if (left <= 0 || left >= reserve) return resources
  return { ...resources, deadlineAtMs: Date.now() + reserve }
}
