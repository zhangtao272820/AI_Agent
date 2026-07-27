/**
 * P3：多租户审计聚合
 */
import { agentPgQuery, isAgentPgConfigured } from './agentPgClient'
import { normalizeTenantId } from './tenantScope'

export type TenantAuditStats = {
  tenantId: string
  sessions: number
  toolCallAuditRows: number
  sessionFeedbackRows: number
  traceEventRows: number
  hitlDecisionRows: number
  kgEntityRows: number
  kgEdgeRows: number
}

export async function queryTenantAuditStats(
  tenantId?: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<TenantAuditStats | null> {
  if (!isAgentPgConfigured(env)) return null
  const tid = normalizeTenantId(tenantId, env)

  const [sessions, audit, feedback, trace, hitl, kgEnt, kgEdge] = await Promise.all([
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_sessions WHERE tenant_id = $1`, [tid], env),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_tool_call_audit WHERE tenant_id = $1`, [tid], env),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM agent_session_feedback WHERE tenant_id = $1`, [tid], env),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_run_trace_events WHERE tenant_id = $1`, [tid], env),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_hitl_decisions WHERE tenant_id = $1`, [tid], env),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_kg_entities WHERE tenant_id = $1`, [tid], env).catch(() => null),
    agentPgQuery<{ n: string }>(`SELECT COUNT(*)::text AS n FROM mgr_kg_edges WHERE tenant_id = $1`, [tid], env).catch(() => null)
  ])

  return {
    tenantId: tid,
    sessions: Number(sessions?.rows?.[0]?.n) || 0,
    toolCallAuditRows: Number(audit?.rows?.[0]?.n) || 0,
    sessionFeedbackRows: Number(feedback?.rows?.[0]?.n) || 0,
    traceEventRows: Number(trace?.rows?.[0]?.n) || 0,
    hitlDecisionRows: Number(hitl?.rows?.[0]?.n) || 0,
    kgEntityRows: Number(kgEnt?.rows?.[0]?.n) || 0,
    kgEdgeRows: Number(kgEdge?.rows?.[0]?.n) || 0
  }
}
