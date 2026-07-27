/**
 * Emit one-line JSON to stdout for Loki / Promtail (P1b-2).
 * Does not replace ad-hoc console.* — only key run lifecycle events.
 */

export type StructuredLogFields = {
  level?: 'debug' | 'info' | 'warn' | 'error'
  msg: string
  agent?: string
  run_id?: string
  trace_id?: string
  [key: string]: string | number | boolean | undefined
}

export function isManagerStructuredLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = String(env.MANAGER_STRUCTURED_LOG ?? '1').trim().toLowerCase()
  return !(flag === '0' || flag === 'false' || flag === 'off' || flag === 'no')
}

export function emitStructuredLog(fields: StructuredLogFields, env: NodeJS.ProcessEnv = process.env): void {
  if (!isManagerStructuredLogEnabled(env)) return
  const payload: Record<string, string | number | boolean> = {
    level: fields.level || 'info',
    msg: String(fields.msg || ''),
    agent: String(fields.agent || 'manager'),
    ts: new Date().toISOString()
  }
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'level' || k === 'msg' || k === 'agent') continue
    if (v === undefined) continue
    payload[k] = v
  }
  try {
    // Single line — Promtail json stage parses the docker log payload.
    console.log(JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

/** Finalize hook: run_id + trace_id for Grafana Explore by run_id. */
export function emitRunFinalizeLog(runId: string, env: NodeJS.ProcessEnv = process.env): void {
  const id = String(runId || '').trim()
  if (!id) return
  emitStructuredLog(
    {
      level: 'info',
      msg: 'manager.run.finalize',
      agent: 'manager',
      run_id: id,
      trace_id: id
    },
    env
  )
}
