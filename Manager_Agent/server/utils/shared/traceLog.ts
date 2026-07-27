import fs from 'node:fs/promises'
import path from 'node:path'

export type TraceLogEntry = {
  ts: string
  service: string
  agent: string
  trace_id?: string
  run_id?: string
  session_id?: string
  user_id?: string
  path?: string
  ok?: boolean
  latency_ms?: number
  detail?: string
  meta?: Record<string, unknown>
}

function traceLogEnabled() {
  const v = String(process.env.MANAGER_AGENT_TRACE ?? '1').trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no')
}

function traceLogPath() {
  return String(process.env.MANAGER_TRACE_LOG_PATH || '').trim() || path.join(process.cwd(), '.data', 'agent-trace.jsonl')
}

export async function appendTraceLog(entry: Omit<TraceLogEntry, 'ts'>) {
  if (!traceLogEnabled()) return
  const row: TraceLogEntry = { ts: new Date().toISOString(), ...entry }
  const file = traceLogPath()
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, `${JSON.stringify(row)}\n`, 'utf8')
  } catch {}
}

export function traceIdFromEvent(event: { node?: { req?: { headers?: Record<string, unknown> } } }) {
  const h = event?.node?.req?.headers || {}
  const raw =
    String(h['x-trace-id'] ?? h['x-run-id'] ?? h['X-Trace-Id'] ?? h['X-Run-Id'] ?? '').trim() ||
    String((event as any)?.context?.trace_id ?? '').trim()
  return raw || undefined
}
