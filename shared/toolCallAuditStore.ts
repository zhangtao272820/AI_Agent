/**
 * P1：子 Agent / 工具调用审计 PG（合规导出、Run 回放）
 */
import { agentPgQuery, isAgentPgConfigured } from './agentPgClient'
import { normalizeTenantId } from './tenantScope'

export type ToolCallAuditInput = {
  runId: string
  sessionId?: string | null
  tenantId?: string | null
  agent: string
  toolName: string
  stepId?: string | null
  ok: boolean
  ms?: number | null
  error?: string | null
  queryPreview?: string | null
  resultPreview?: string | null
  metadata?: Record<string, unknown> | null
}

export type ToolCallAuditRow = {
  id: number
  runId: string
  sessionId: string | null
  agent: string
  toolName: string
  stepId: string | null
  ok: boolean
  ms: number | null
  error: string | null
  queryPreview: string | null
  resultPreview: string | null
  metadata: Record<string, unknown>
  ts: string
}

export function isToolCallAuditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_TOOL_CALL_AUDIT ?? '1').trim() !== '0'
}

export async function recordToolCallAudit(
  input: ToolCallAuditInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  if (!isToolCallAuditEnabled(env) || !isAgentPgConfigured(env)) return false
  const runId = String(input.runId || '').slice(0, 80)
  const agent = String(input.agent || 'unknown').slice(0, 32)
  const toolName = String(input.toolName || agent).slice(0, 128)
  if (!runId || !agent) return false
  const res = await agentPgQuery(
    `INSERT INTO mgr_tool_call_audit
       (run_id, session_id, tenant_id, agent, tool_name, step_id, ok, ms, error, query_preview, result_preview, metadata, ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW())`,
    [
      runId,
      input.sessionId ? String(input.sessionId).slice(0, 120) : null,
      normalizeTenantId(input.tenantId, env),
      agent,
      toolName,
      input.stepId ? String(input.stepId).slice(0, 64) : null,
      Boolean(input.ok),
      typeof input.ms === 'number' && Number.isFinite(input.ms) ? Math.floor(input.ms) : null,
      input.error ? String(input.error).slice(0, 500) : null,
      input.queryPreview ? String(input.queryPreview).slice(0, 400) : null,
      input.resultPreview ? String(input.resultPreview).slice(0, 520) : null,
      JSON.stringify(input.metadata && typeof input.metadata === 'object' ? input.metadata : {})
    ],
    env
  )
  return Boolean(res)
}

export async function listToolCallAuditForRun(
  runId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ToolCallAuditRow[]> {
  if (!isAgentPgConfigured(env)) return []
  const rid = String(runId || '').slice(0, 80)
  if (!rid) return []
  const res = await agentPgQuery<{
    id: number
    run_id: string
    session_id: string | null
    agent: string
    tool_name: string
    step_id: string | null
    ok: boolean
    ms: number | null
    error: string | null
    query_preview: string | null
    result_preview: string | null
    metadata: unknown
    ts: string
  }>(
    `SELECT id, run_id, session_id, agent, tool_name, step_id, ok, ms, error, query_preview, result_preview, metadata, ts
     FROM mgr_tool_call_audit WHERE run_id = $1 ORDER BY id ASC`,
    [rid],
    env
  )
  return (res?.rows ?? []).map(mapAuditRow)
}

export async function listToolCallAuditRecent(
  opts?: { sessionId?: string; limit?: number },
  env: NodeJS.ProcessEnv = process.env
): Promise<ToolCallAuditRow[]> {
  if (!isAgentPgConfigured(env)) return []
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 50))
  const sid = opts?.sessionId ? String(opts.sessionId).slice(0, 120) : null
  const res = await agentPgQuery<{
    id: number
    run_id: string
    session_id: string | null
    agent: string
    tool_name: string
    step_id: string | null
    ok: boolean
    ms: number | null
    error: string | null
    query_preview: string | null
    result_preview: string | null
    metadata: unknown
    ts: string
  }>(
    sid
      ? `SELECT id, run_id, session_id, agent, tool_name, step_id, ok, ms, error, query_preview, result_preview, metadata, ts
         FROM mgr_tool_call_audit WHERE session_id = $1 ORDER BY id DESC LIMIT $2`
      : `SELECT id, run_id, session_id, agent, tool_name, step_id, ok, ms, error, query_preview, result_preview, metadata, ts
         FROM mgr_tool_call_audit ORDER BY id DESC LIMIT $1`,
    sid ? [sid, limit] : [limit],
    env
  )
  return (res?.rows ?? []).map(mapAuditRow)
}

function mapAuditRow(r: {
  id: number
  run_id: string
  session_id: string | null
  agent: string
  tool_name: string
  step_id: string | null
  ok: boolean
  ms: number | null
  error: string | null
  query_preview: string | null
  result_preview: string | null
  metadata: unknown
  ts: string
}): ToolCallAuditRow {
  return {
    id: r.id,
    runId: r.run_id,
    sessionId: r.session_id,
    agent: r.agent,
    toolName: r.tool_name,
    stepId: r.step_id,
    ok: r.ok,
    ms: r.ms,
    error: r.error,
    queryPreview: r.query_preview,
    resultPreview: r.result_preview,
    metadata: (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, unknown>,
    ts: r.ts
  }
}
