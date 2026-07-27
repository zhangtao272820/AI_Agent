import type { Step } from './taskPlan'

export type PlanConfirmResult =
  | { action: 'execute'; steps?: Step[]; constraints?: string }
  | { action: 'cancel' }

type Waiter = { resolve: (r: PlanConfirmResult) => void; timer: ReturnType<typeof setTimeout> }

const waiters = new Map<string, Waiter>()

function waiterKey(runId: string, previewId: string) {
  return `${String(runId || '').trim()}::${String(previewId || '').trim()}`
}

export function waitPlanConfirm(runId: string, previewId: string, timeoutMs = 600_000): Promise<PlanConfirmResult> {
  const rid = String(runId || '').trim()
  const pid = String(previewId || '').trim()
  if (!rid || !pid) return Promise.resolve({ action: 'cancel' })
  return new Promise((resolve) => {
    const k = waiterKey(rid, pid)
    const timer = setTimeout(() => {
      waiters.delete(k)
      resolve({ action: 'cancel' })
    }, timeoutMs)
    waiters.set(k, {
      resolve: (r) => {
        clearTimeout(timer)
        resolve(r)
      },
      timer
    })
  })
}

export function resolvePlanConfirm(runId: string, previewId: string, result: PlanConfirmResult): boolean {
  const k = waiterKey(runId, previewId)
  const w = waiters.get(k)
  if (!w) return false
  waiters.delete(k)
  clearTimeout(w.timer)
  w.resolve(result)
  return true
}

export function cancelPlanConfirmsForRun(runId: string) {
  const prefix = `${String(runId || '').trim()}::`
  if (!prefix || prefix === '::') return
  for (const [k, w] of waiters) {
    if (!k.startsWith(prefix)) continue
    waiters.delete(k)
    clearTimeout(w.timer)
    w.resolve({ action: 'cancel' })
  }
}
