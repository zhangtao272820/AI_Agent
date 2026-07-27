/**
 * P1：Run 级 Trace 与 HITL 决策 PG 存储（文件 jsonl 双写互补）
 */
import { agentPgQuery, isAgentPgConfigured } from './agentPgClient'
import { normalizeTenantId } from './tenantScope'

export type RunTraceEventInput = {
  runId: string
  sessionId?: string | null
  tenantId?: string | null
  event: string
  fromAgent?: string | null
  payload?: Record<string, unknown> | unknown
  ts?: string
}

export type RunTraceEventRow = {
  id: number
  runId: string
  sessionId: string | null
  event: string
  fromAgent: string | null
  payload: Record<string, unknown>
  ts: string
}

export type HitlDecisionInput = {
  runId: string
  sessionId: string
  tenantId?: string | null
  confirmId?: string | null
  decision: 'confirm' | 'cancel' | 'reject'
  reason?: string | null
  payload?: Record<string, unknown> | null
}

export type HitlDecisionRow = {
  id: number
  runId: string
  sessionId: string
  confirmId: string | null
  decision: string
  reason: string | null
  payload: Record<string, unknown>
  ts: string
}

function clipPayload(payload: unknown, maxLen = 4000): Record<string, unknown> {
  if (payload == null) return {}
  if (typeof payload === 'string') {
    const s = payload.length > maxLen ? `${payload.slice(0, maxLen)}…` : payload
    return { text: s }
  }
  if (typeof payload === 'number' || typeof payload === 'boolean') return { value: payload }
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    try {
      const json = JSON.stringify(payload)
      if (json.length <= maxLen) return payload as Record<string, unknown>
      return { clipped: json.slice(0, maxLen) }
    } catch {
      return { clipped: String(payload).slice(0, maxLen) }
    }
  }
  return { clipped: String(payload).slice(0, maxLen) }
}

export async function appendRunTraceEvent(
  input: RunTraceEventInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  if (!isAgentPgConfigured(env)) return false
  const runId = String(input.runId || '').slice(0, 80)
  const event = String(input.event || '').slice(0, 40)
  if (!runId || !event) return false
  const res = await agentPgQuery(
    `INSERT INTO mgr_run_trace_events (run_id, session_id, tenant_id, event, from_agent, payload, ts)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, NOW()))`,
    [
      runId,
      input.sessionId ? String(input.sessionId).slice(0, 120) : null,
      normalizeTenantId(input.tenantId, env),
      event,
      input.fromAgent ? String(input.fromAgent).slice(0, 24) : null,
      JSON.stringify(clipPayload(input.payload)),
      input.ts ?? null
    ],
    env
  )
  return Boolean(res)
}

export async function listRunTraceEvents(
  runId: string,
  opts?: { limit?: number },
  env: NodeJS.ProcessEnv = process.env
): Promise<RunTraceEventRow[]> {
  if (!isAgentPgConfigured(env)) return []
  const rid = String(runId || '').slice(0, 80)
  if (!rid) return []
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 200))
  const res = await agentPgQuery<{
    id: number
    run_id: string
    session_id: string | null
    event: string
    from_agent: string | null
    payload: unknown
    ts: string
  }>(
    `SELECT id, run_id, session_id, event, from_agent, payload, ts
     FROM mgr_run_trace_events WHERE run_id = $1 ORDER BY id ASC LIMIT $2`,
    [rid, limit],
    env
  )
  return (res?.rows ?? []).map((r) => ({
    id: r.id,
    runId: r.run_id,
    sessionId: r.session_id,
    event: r.event,
    fromAgent: r.from_agent,
    payload: (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>,
    ts: r.ts
  }))
}

export async function recordHitlDecision(
  input: HitlDecisionInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  if (!isAgentPgConfigured(env)) return false
  const runId = String(input.runId || '').slice(0, 80)
  const sessionId = String(input.sessionId || '').slice(0, 120)
  const decision = input.decision
  if (!runId || !sessionId || !decision) return false
  const res = await agentPgQuery(
    `INSERT INTO mgr_hitl_decisions (run_id, session_id, tenant_id, confirm_id, decision, reason, payload, ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
    [
      runId,
      sessionId,
      normalizeTenantId(input.tenantId, env),
      input.confirmId ? String(input.confirmId).slice(0, 120) : null,
      decision,
      input.reason ? String(input.reason).slice(0, 2000) : null,
      JSON.stringify(input.payload && typeof input.payload === 'object' ? input.payload : {})
    ],
    env
  )
  return Boolean(res)
}

export async function listHitlDecisionsForRun(
  runId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<HitlDecisionRow[]> {
  if (!isAgentPgConfigured(env)) return []
  const rid = String(runId || '').slice(0, 80)
  if (!rid) return []
  const res = await agentPgQuery<{
    id: number
    run_id: string
    session_id: string
    confirm_id: string | null
    decision: string
    reason: string | null
    payload: unknown
    ts: string
  }>(
    `SELECT id, run_id, session_id, confirm_id, decision, reason, payload, ts
     FROM mgr_hitl_decisions WHERE run_id = $1 ORDER BY id ASC`,
    [rid],
    env
  )
  return (res?.rows ?? []).map((r) => ({
    id: r.id,
    runId: r.run_id,
    sessionId: r.session_id,
    confirmId: r.confirm_id,
    decision: r.decision,
    reason: r.reason,
    payload: (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>,
    ts: r.ts
  }))
}
