import { agentHealthProbeTimeoutMs } from '../probe/probeConfig'

export type ServiceReadyResult = {
  ok: boolean
  ready: boolean
  healthOk: boolean
  detail?: string
}

/** health≠ready：优先 /api/ready，回退 /api/health 并读取 ready 字段 */
export async function probeServiceReady(
  baseUrl: string,
  timeoutMs = agentHealthProbeTimeoutMs()
): Promise<ServiceReadyResult> {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return { ok: false, ready: false, healthOk: false, detail: 'no_base' }

  try {
    const readyRes = await fetch(`${base}/api/ready`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (readyRes.ok) {
      const body = (await readyRes.json().catch(() => ({}))) as { ready?: boolean; ok?: boolean; detail?: string }
      const ready = Boolean(body.ready ?? body.ok)
      return { ok: ready, ready, healthOk: true, detail: String(body.detail || 'ready_endpoint') }
    }
  } catch {
    /* fall through */
  }

  try {
    const healthRes = await fetch(`${base}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (healthRes.ok) {
      const body = (await healthRes.json().catch(() => ({}))) as { ready?: boolean; ok?: boolean }
      const ready = Boolean(body.ready)
      return { ok: true, ready, healthOk: true, detail: ready ? 'health_ready' : 'health_only' }
    }
  } catch {
    /* fall through */
  }

  return { ok: false, ready: false, healthOk: false, detail: 'unreachable' }
}
