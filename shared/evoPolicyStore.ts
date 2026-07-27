/**
 * evo_policy_versions：shadow / active / rollback 事务化版本库
 */

import { agentPgQuery } from './agentPgClient'

export type EvoPolicyStatus = 'shadow' | 'active' | 'rolled_back'

export type EvoPolicyRow = {
  agent: string
  stage: string
  version: number
  status: EvoPolicyStatus
  payload: Record<string, unknown>
  promoted_at?: string | null
}

function nextVersion(rows: { version: number }[]): number {
  const max = rows.reduce((m, r) => Math.max(m, Number(r.version) || 0), 0)
  return max + 1
}

export async function writeEvoShadowPolicy(
  agent: string,
  stage: string,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env
): Promise<EvoPolicyRow | null> {
  const existing = await agentPgQuery<{ version: number }>(
    `SELECT version FROM evo_policy_versions
     WHERE agent = $1 AND stage = $2 AND status = 'shadow'
     ORDER BY version DESC LIMIT 1`,
    [agent, stage],
    env
  )
  const version = nextVersion(existing?.rows ?? [])
  await agentPgQuery(
    `UPDATE evo_policy_versions SET status = 'rolled_back'
     WHERE agent = $1 AND stage = $2 AND status = 'shadow'`,
    [agent, stage],
    env
  )
  const res = await agentPgQuery<{ version: number }>(
    `INSERT INTO evo_policy_versions (agent, stage, version, status, payload)
     VALUES ($1, $2, $3, 'shadow', $4)
     RETURNING version`,
    [agent, stage, version, JSON.stringify(payload)],
    env
  )
  if (!res?.rows?.[0]) return null
  return { agent, stage, version, status: 'shadow', payload }
}

export async function getEvoActivePolicy(
  agent: string,
  stage: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<EvoPolicyRow | null> {
  const res = await agentPgQuery<{ version: number; status: EvoPolicyStatus; payload: Record<string, unknown>; promoted_at: string | null }>(
    `SELECT version, status, payload, promoted_at FROM evo_policy_versions
     WHERE agent = $1 AND stage = $2 AND status = 'active'
     ORDER BY version DESC LIMIT 1`,
    [agent, stage],
    env
  )
  const row = res?.rows?.[0]
  if (!row) return null
  return { agent, stage, version: row.version, status: row.status, payload: row.payload, promoted_at: row.promoted_at }
}

export async function promoteEvoPolicy(
  agent: string,
  stage: string,
  opts?: { shadowPayload?: Record<string, unknown>; verifyOk?: boolean },
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: boolean; reason?: string; version?: number }> {
  if (opts?.verifyOk === false) {
    return { ok: false, reason: 'verify_failed' }
  }

  let payload = opts?.shadowPayload
  if (!payload) {
    const shadow = await agentPgQuery<{ version: number; payload: Record<string, unknown> }>(
      `SELECT version, payload FROM evo_policy_versions
       WHERE agent = $1 AND stage = $2 AND status = 'shadow'
       ORDER BY version DESC LIMIT 1`,
      [agent, stage],
      env
    )
    payload = shadow?.rows?.[0]?.payload
    if (!payload) return { ok: false, reason: 'no_shadow' }
  }

  const active = await agentPgQuery<{ version: number }>(
    `SELECT version FROM evo_policy_versions
     WHERE agent = $1 AND stage = $2 AND status = 'active'
     ORDER BY version DESC LIMIT 1`,
    [agent, stage],
    env
  )
  const version = nextVersion([...(active?.rows ?? []), { version: 0 }])

  await agentPgQuery(
    `UPDATE evo_policy_versions SET status = 'rolled_back', promoted_at = NOW()
     WHERE agent = $1 AND stage = $2 AND status = 'active'`,
    [agent, stage],
    env
  )
  await agentPgQuery(
    `UPDATE evo_policy_versions SET status = 'rolled_back'
     WHERE agent = $1 AND stage = $2 AND status = 'shadow'`,
    [agent, stage],
    env
  )
  const ins = await agentPgQuery<{ version: number }>(
    `INSERT INTO evo_policy_versions (agent, stage, version, status, payload, promoted_at)
     VALUES ($1, $2, $3, 'active', $4, NOW())
     RETURNING version`,
    [agent, stage, version, JSON.stringify(payload)],
    env
  )
  if (!ins?.rows?.[0]) return { ok: false, reason: 'insert_failed' }
  return { ok: true, version: ins.rows[0].version }
}

export async function rollbackEvoPolicy(
  agent: string,
  stage: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: boolean; reason?: string }> {
  const prev = await agentPgQuery<{ version: number; payload: Record<string, unknown> }>(
    `SELECT version, payload FROM evo_policy_versions
     WHERE agent = $1 AND stage = $2 AND status = 'rolled_back'
     ORDER BY promoted_at DESC NULLS LAST, version DESC LIMIT 1`,
    [agent, stage],
    env
  )
  const row = prev?.rows?.[0]
  if (!row) return { ok: false, reason: 'no_rollback_target' }

  await agentPgQuery(
    `UPDATE evo_policy_versions SET status = 'rolled_back', promoted_at = NOW()
     WHERE agent = $1 AND stage = $2 AND status = 'active'`,
    [agent, stage],
    env
  )
  await agentPgQuery(
    `INSERT INTO evo_policy_versions (agent, stage, version, status, payload, promoted_at)
     VALUES ($1, $2, $3, 'active', $4, NOW())`,
    [agent, stage, row.version + 1000, JSON.stringify(row.payload)],
    env
  )
  return { ok: true }
}

export async function listEvoPolicies(
  agent: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<EvoPolicyRow[]> {
  const res = await agentPgQuery<{ stage: string; version: number; status: EvoPolicyStatus; payload: Record<string, unknown>; promoted_at: string | null }>(
    `SELECT stage, version, status, payload, promoted_at FROM evo_policy_versions
     WHERE agent = $1 AND status IN ('shadow', 'active')
     ORDER BY stage, version DESC`,
    [agent],
    env
  )
  return (res?.rows ?? []).map((r) => ({
    agent,
    stage: r.stage,
    version: r.version,
    status: r.status,
    payload: r.payload,
    promoted_at: r.promoted_at
  }))
}
