import { agentHealthProbeTimeoutMs } from '../../graph/core/probe/probeConfig'

export function isAdminReadinessProbeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_ADMIN_READINESS_PROBE ?? '0').trim() === '1'
}

export type AdminReadinessProbe = {
  ok: boolean
  weatherConfigured: boolean
  detail?: string
}

/** plan 阶段可选探测 Admin `/api/ready`（早失败，非 regex 路由） */
export async function probeAdminAgentReadiness(
  httpBase: string,
  timeoutMs = agentHealthProbeTimeoutMs()
): Promise<AdminReadinessProbe> {
  const base = String(httpBase || '').trim().replace(/\/+$/, '')
  if (!base) return { ok: false, weatherConfigured: false, detail: 'no_base' }

  try {
    const res = await fetch(`${base}/api/ready`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) {
      return { ok: false, weatherConfigured: false, detail: `http_${res.status}` }
    }
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      status?: string
      checks?: { weather?: { configured?: boolean; has_key?: boolean; has_host?: boolean } }
    }
    const weather = body.checks?.weather
    const weatherConfigured = Boolean(weather?.configured ?? (weather?.has_key && weather?.has_host))
    const ok = Boolean(body.ok ?? body.status === 'ok')
    return {
      ok,
      weatherConfigured,
      detail: ok ? 'ready' : 'degraded'
    }
  } catch (e) {
    return {
      ok: false,
      weatherConfigured: false,
      detail: e instanceof Error ? e.message.slice(0, 120) : 'fetch_error'
    }
  }
}
