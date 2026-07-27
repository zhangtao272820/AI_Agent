/** 统一 critic / optimizer / 门禁 的重试预算，避免 fix→synth 死循环耗尽 recursionLimit */

export type ManagerRetryLimits = {
  retryCount: number
  maxRetry: number
  maxRetries: number
  maxRetriesSingle: number
  isMulti: boolean
}

export function readManagerMaxRetryEnv(): number {
  const raw = Number(process.env.MANAGER_MAX_RETRY ?? 1)
  if (!Number.isFinite(raw)) return 1
  return Math.max(0, Math.min(5, Math.floor(raw)))
}

export function resolveManagerRetryLimits(
  state: {
    retryCount?: number
    intent?: string
    plan?: unknown[]
  },
  policy?: { critic?: { maxRetriesSingle?: number; maxRetriesMulti?: number } }
): ManagerRetryLimits {
  const retryCount = Number(state?.retryCount ?? 0) || 0
  const maxRetry = readManagerMaxRetryEnv()
  const maxRetriesSingle = Math.max(0, Math.min(3, Number(policy?.critic?.maxRetriesSingle ?? 1)))
  const planLen = Array.isArray(state?.plan) ? state.plan.length : 0
  const isMulti = String(state?.intent ?? '') === 'multi' || planLen > 1
  const maxRetries = Math.max(
    0,
    Math.min(5, Number(isMulti ? policy?.critic?.maxRetriesMulti ?? 2 : maxRetriesSingle))
  )
  return { retryCount, maxRetry, maxRetries, maxRetriesSingle, isMulti }
}

/** optimizer / critic 是否还应触发 fix 或门禁重试 */
export function canManagerRetryMore(limits: ManagerRetryLimits): boolean {
  const ceiling = limits.isMulti ? limits.maxRetries : limits.maxRetriesSingle
  return limits.retryCount < limits.maxRetry && limits.retryCount < ceiling
}

export function isManagerRetryBudgetExhausted(limits: ManagerRetryLimits): boolean {
  return !canManagerRetryMore(limits)
}

export function readManagerRecursionLimit(): number {
  const raw = Number(process.env.MANAGER_GRAPH_RECURSION_LIMIT ?? 48)
  if (!Number.isFinite(raw)) return 48
  return Math.max(25, Math.min(120, Math.floor(raw)))
}
