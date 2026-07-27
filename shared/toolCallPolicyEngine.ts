/**
 * P3：OPA 风格 Tool Call 策略引擎（JSON 规则，审计/拒绝）
 */
import { agentPgQuery, isAgentPgConfigured } from './agentPgClient'

export type PolicyEffect = 'allow' | 'deny' | 'audit'

export type PolicyRule = {
  id: string
  name: string
  effect: PolicyEffect
  priority: number
  match: Record<string, unknown>
  enabled: boolean
  source: string
}

export type ToolCallPolicyInput = {
  agent: string
  toolName?: string
  ok?: boolean
  sessionId?: string | null
  tenantId?: string | null
  risk?: 'low' | 'medium' | 'high'
  readOnly?: boolean
  metadata?: Record<string, unknown>
}

export type ToolCallPolicyDecision = {
  allow: boolean
  audit: boolean
  matchedRules: string[]
  reasons: string[]
}

export function isToolCallPolicyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_TOOL_CALL_POLICY ?? '1').trim() !== '0'
}

function defaultRules(): PolicyRule[] {
  return [
    {
      id: 'audit_failed_tools',
      name: '审计失败工具调用',
      effect: 'audit',
      priority: 50,
      match: { ok: false },
      enabled: true,
      source: 'builtin'
    },
    {
      id: 'audit_high_risk_agents',
      name: '审计高风险 Agent',
      effect: 'audit',
      priority: 60,
      match: { agents: ['gui'] },
      enabled: true,
      source: 'builtin'
    },
    {
      id: 'audit_admin_write_ops',
      name: '审计 Admin 写操作',
      effect: 'audit',
      priority: 55,
      match: { agents: ['admin'], readOnly: false },
      enabled: true,
      source: 'builtin'
    },
    {
      id: 'deny_gui_without_session',
      name: 'GUI 无 session 拒绝',
      effect: 'deny',
      priority: 200,
      match: { agents: ['gui'], requireSession: true },
      enabled: true,
      source: 'builtin'
    }
  ]
}

function ruleMatches(rule: PolicyRule, input: ToolCallPolicyInput): boolean {
  const m = rule.match || {}
  const agent = String(input.agent || input.toolName || '').trim().toLowerCase()

  const agents = Array.isArray(m.agents) ? m.agents.map((a) => String(a).toLowerCase()) : []
  if (agents.length && !agents.includes(agent)) return false

  if (m.ok === false && input.ok !== false) return false
  if (m.ok === true && input.ok !== true) return false

  if (m.requireSession === true && String(input.sessionId || '').trim()) return false

  if (m.readOnly === false && input.readOnly === true) return false
  if (m.readOnly === true && input.readOnly !== true) return false

  const risk = String(input.risk || '').toLowerCase()
  const risks = Array.isArray(m.risks) ? m.risks.map((r) => String(r).toLowerCase()) : []
  if (risks.length && !risks.includes(risk)) return false

  const tenant = String(input.tenantId || 'default')
  const tenants = Array.isArray(m.tenants) ? m.tenants.map(String) : []
  if (tenants.length && !tenants.includes(tenant)) return false

  return true
}

export async function loadPolicyRules(env: NodeJS.ProcessEnv = process.env): Promise<PolicyRule[]> {
  const merged = new Map<string, PolicyRule>()
  for (const r of defaultRules()) merged.set(r.id, r)

  if (isAgentPgConfigured(env)) {
    const res = await agentPgQuery<{
      id: string
      name: string
      effect: string
      priority: number
      match_json: unknown
      enabled: boolean
      source: string
    }>(
      `SELECT id, name, effect, priority, match_json, enabled, source
       FROM mgr_policy_rules WHERE enabled = TRUE ORDER BY priority DESC`,
      [],
      env
    ).catch(() => null)

    for (const row of res?.rows ?? []) {
      merged.set(row.id, {
        id: row.id,
        name: row.name,
        effect: (['allow', 'deny', 'audit'].includes(row.effect) ? row.effect : 'audit') as PolicyEffect,
        priority: Number(row.priority) || 100,
        match: (row.match_json && typeof row.match_json === 'object' ? row.match_json : {}) as Record<string, unknown>,
        enabled: row.enabled !== false,
        source: row.source || 'pg'
      })
    }
  }

  return [...merged.values()].filter((r) => r.enabled).sort((a, b) => b.priority - a.priority)
}

export async function evaluateToolCallPolicy(
  input: ToolCallPolicyInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<ToolCallPolicyDecision> {
  if (!isToolCallPolicyEnabled(env)) {
    return { allow: true, audit: false, matchedRules: [], reasons: [] }
  }

  const rules = await loadPolicyRules(env)
  const matchedRules: string[] = []
  const reasons: string[] = []
  let allow = true
  let audit = false

  for (const rule of rules) {
    if (!ruleMatches(rule, input)) continue
    // 只读 Admin（天气/路线查询等）不走「高风险 Agent」审计；写操作由 audit_admin_write_ops 覆盖
    if (rule.id === 'audit_high_risk_agents' && input.agent === 'admin' && input.readOnly) continue
    matchedRules.push(rule.id)
    if (rule.effect === 'deny') {
      allow = false
      reasons.push(rule.name)
    } else if (rule.effect === 'audit') {
      audit = true
      reasons.push(`audit:${rule.name}`)
    }
  }

  return { allow, audit, matchedRules, reasons }
}

/** 执行前门禁（admin/gui 等高风险步骤） */
export async function assertToolCallAllowed(
  input: ToolCallPolicyInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true } | { ok: false; decision: ToolCallPolicyDecision }> {
  const decision = await evaluateToolCallPolicy(input, env)
  if (!decision.allow) return { ok: false, decision }
  return { ok: true }
}
