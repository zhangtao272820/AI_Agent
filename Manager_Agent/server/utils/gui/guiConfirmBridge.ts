type Waiter = { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }

const waiters = new Map<string, Waiter>()

function waiterKey(runId: string, confirmId: string) {
  return `${String(runId || '').trim()}::${String(confirmId || '').trim()}`
}

export function waitGuiConfirm(runId: string, confirmId: string, timeoutMs = 300_000): Promise<boolean> {
  const rid = String(runId || '').trim()
  const cid = String(confirmId || '').trim()
  if (!rid || !cid) return Promise.resolve(false)
  return new Promise((resolve) => {
    const k = waiterKey(rid, cid)
    const timer = setTimeout(() => {
      waiters.delete(k)
      resolve(false)
    }, timeoutMs)
    waiters.set(k, {
      resolve: (ok) => {
        clearTimeout(timer)
        resolve(ok)
      },
      timer
    })
  })
}

export function resolveGuiConfirm(runId: string, confirmId: string, ok: boolean): boolean {
  const k = waiterKey(runId, confirmId)
  const w = waiters.get(k)
  if (!w) return false
  waiters.delete(k)
  clearTimeout(w.timer)
  w.resolve(ok)
  return true
}

export function cancelGuiConfirmsForRun(runId: string) {
  const prefix = `${String(runId || '').trim()}::`
  if (!prefix || prefix === '::') return
  for (const [k, w] of waiters) {
    if (!k.startsWith(prefix)) continue
    waiters.delete(k)
    clearTimeout(w.timer)
    w.resolve(false)
  }
}
