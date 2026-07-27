/** 对外部 Agent 做轻量 HTTP 存活探测（不阻塞主路径过久） */

import { dbProbeTimeoutMs } from './probeConfig'

async function fetchReachable(url: string, init: RequestInit, timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), Math.max(500, timeoutMs))
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

export async function probeHttpHealth(
  baseUrl: string,
  healthPath = '/api/health',
  timeoutMs = 2200
): Promise<'ok' | 'fail'> {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base || base === 'internal') return 'fail'
  const path = healthPath.startsWith('/') ? healthPath : `/${healthPath}`
  const url = `${base}${path}`
  const ok = await fetchReachable(url, { method: 'GET' }, timeoutMs)
  return ok ? 'ok' : 'fail'
}

/** DB/RAG 等：/api/health 不存在时回退 POST /api/probe */
export async function probeHttpService(
  baseUrl: string,
  opts?: { healthPath?: string; probePath?: string; timeoutMs?: number }
): Promise<'ok' | 'fail'> {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return 'fail'
  const timeoutMs = opts?.timeoutMs ?? dbProbeTimeoutMs()
  const health = await probeHttpHealth(base, opts?.healthPath || '/api/health', timeoutMs)
  if (health === 'ok') return 'ok'
  const probePath = opts?.probePath || '/api/probe'
  const url = `${base}${probePath.startsWith('/') ? probePath : `/${probePath}`}`
  const body =
    probePath.includes('probe') && base.includes('13101')
      ? JSON.stringify({ question: 'ping', dbId: process.env.DB_ID || undefined })
      : JSON.stringify({ query: 'ping', k: 1 })
  const ok = await fetchReachable(
    url,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
    timeoutMs
  )
  return ok ? 'ok' : 'fail'
}
