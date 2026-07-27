/**
 * 统一周期 Audit + PG 分布式锁（advisory lock）
 */

import { agentPgQuery } from './agentPgClient'
import { verifyBeforePromote } from './evolutionVerify'

export type EvoAuditReport = {
  ts: string
  jobName: string
  agent?: string
  locked: boolean
  skipped?: string
  verify?: Awaited<ReturnType<typeof verifyBeforePromote>>
  curator?: Record<string, unknown>
}

function lockKey(jobKey: string): number {
  let h = 0
  for (let i = 0; i < jobKey.length; i++) {
    h = (h * 31 + jobKey.charCodeAt(i)) | 0
  }
  return Math.abs(h) || 1
}

export async function tryAcquireCuratorLock(
  jobKey: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const res = await agentPgQuery<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [lockKey(jobKey)],
    env
  )
  return Boolean(res?.rows?.[0]?.locked)
}

export async function releaseCuratorLock(jobKey: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await agentPgQuery('SELECT pg_advisory_unlock($1)', [lockKey(jobKey)], env)
}

export async function recordEvoAuditRun(
  jobName: string,
  report: Record<string, unknown>,
  agent?: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await agentPgQuery(
    `INSERT INTO evo_audit_runs (job_name, agent, finished_at, report) VALUES ($1, $2, NOW(), $3)`,
    [jobName, agent ?? null, JSON.stringify(report)],
    env
  )
  await agentPgQuery(
    `INSERT INTO evo_curator_state (job_key, last_run_at, last_report)
     VALUES ($1, NOW(), $2)
     ON CONFLICT (job_key) DO UPDATE SET last_run_at = NOW(), last_report = EXCLUDED.last_report`,
    [jobName, JSON.stringify(report)],
    env
  )
}

export async function withCuratorLock<T>(
  jobKey: string,
  fn: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ locked: boolean; result?: T }> {
  const locked = await tryAcquireCuratorLock(jobKey, env)
  if (!locked) return { locked: false }
  try {
    return { locked: true, result: await fn() }
  } finally {
    await releaseCuratorLock(jobKey, env)
  }
}

export function isEvoAuditJobEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.EVO_AUDIT_JOB ?? '1').trim() !== '0'
}

export function evoAuditIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.EVO_AUDIT_INTERVAL_MS ?? 86_400_000)
  return Number.isFinite(n) && n >= 300_000 ? Math.min(7 * 86_400_000, Math.floor(n)) : 86_400_000
}

/** 日聚合 Audit：信号摘要 + verify 探针 */
export async function runEvoAuditProbe(
  agent: 'db' | 'manager' | 'rag' | 'admin',
  env: NodeJS.ProcessEnv = process.env
): Promise<EvoAuditReport> {
  const verify = await verifyBeforePromote(agent, env)
  const report: EvoAuditReport = {
    ts: new Date().toISOString(),
    jobName: `evo_audit_${agent}`,
    agent,
    locked: true,
    verify
  }
  await recordEvoAuditRun(report.jobName, report as unknown as Record<string, unknown>, agent, env)
  return report
}

export async function runUnifiedEvoAuditJob(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: boolean; reports: EvoAuditReport[]; skipped?: boolean }> {
  if (!isEvoAuditJobEnabled(env)) return { ok: true, reports: [], skipped: true }

  const { locked, result } = await withCuratorLock('evo_audit_unified', async () => {
    const agents = ['db', 'manager', 'rag', 'admin'] as const
    const reports: EvoAuditReport[] = []
    for (const agent of agents) {
      reports.push(await runEvoAuditProbe(agent, env))
    }
    return reports
  }, env)

  if (!locked) return { ok: true, reports: [], skipped: true }
  return { ok: true, reports: result ?? [] }
}
