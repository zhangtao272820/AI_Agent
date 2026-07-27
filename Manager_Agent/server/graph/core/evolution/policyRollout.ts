import fs from 'node:fs/promises'
import path from 'node:path'
import { restoreManagerPolicyFromPrevious } from '../shared'

export function isPolicyAutoRollbackEnabled() {
  const v = String(process.env.MANAGER_POLICY_AUTO_ROLLBACK ?? '1').trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no')
}

function minSamples() {
  const n = Number(process.env.MANAGER_POLICY_ROLLBACK_MIN_SAMPLES ?? 10)
  return Number.isFinite(n) && n >= 3 ? Math.min(80, Math.floor(n)) : 10
}

function dropThreshold() {
  const n = Number(process.env.MANAGER_POLICY_ROLLBACK_DROP_THRESH ?? 0.08)
  return Number.isFinite(n) && n > 0.02 && n < 0.35 ? n : 0.08
}

async function readJsonlTail(file: string, maxLines: number): Promise<any[]> {
  const text = await fs.readFile(file, 'utf8').catch(() => '')
  if (!text.trim()) return []
  const lines = text.split('\n').filter((l) => l.trim()).slice(-Math.max(1, maxLines))
  const out: any[] = []
  for (const line of lines) {
    try {
      out.push(JSON.parse(line))
    } catch {}
  }
  return out
}

async function appendRollout(dir: string, row: Record<string, any>) {
  const p = path.join(dir, 'manager-policy-rollout.jsonl')
  await fs.appendFile(p, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`, 'utf8')
}

/** 在写入新策略前调用：记录基线 finalConfidence（用于后续自动回滚） */
export async function recordPolicyRolloutBaseline(dir: string, fromVersion: number, toVersion: number) {
  const metPath = path.join(dir, 'manager-nlu-metrics.jsonl')
  const rows = await readJsonlTail(metPath, 48)
  const finals = rows
    .map((r) => Number(r?.finalConfidence))
    .filter((x) => Number.isFinite(x))
  if (finals.length < 5) return
  const baselineAvg = finals.reduce((a, b) => a + b, 0) / finals.length
  await appendRollout(dir, {
    kind: 'promote',
    fromVersion,
    toVersion,
    baselineAvgFinalConfidence: Math.round(baselineAvg * 1000) / 1000,
    baselineSampleCount: finals.length
  })
}

/**
 * 新策略上线后，根据带 policyVersion 的 NLU 指标判断是否显著劣化；劣化则回滚到 manager-policy.previous.json。
 */
export async function maybeRollbackPolicyFromNluMetrics(dir: string): Promise<{ rolledBack: boolean; reason?: string }> {
  if (!isPolicyAutoRollbackEnabled()) return { rolledBack: false, reason: 'disabled' }

  const rolloutPath = path.join(dir, 'manager-policy-rollout.jsonl')
  const rollRows = await readJsonlTail(rolloutPath, 120)
  const rollbacks = new Set(
    rollRows.filter((r) => r?.kind === 'auto_rollback' && typeof r?.revertedFromVersion === 'number').map((r) => Number(r.revertedFromVersion))
  )
  const lastPromote = [...rollRows].reverse().find((r) => {
    if (r?.kind !== 'promote' || typeof r?.toVersion !== 'number') return false
    if (rollbacks.has(Number(r.toVersion))) return false
    return true
  })
  if (!lastPromote) return { rolledBack: false, reason: 'no_active_promote' }

  const targetVersion = Number(lastPromote.toVersion)
  const baseline = Number(lastPromote.baselineAvgFinalConfidence)
  if (!Number.isFinite(targetVersion) || !Number.isFinite(baseline)) return { rolledBack: false, reason: 'bad_rollout_row' }

  const metPath = path.join(dir, 'manager-nlu-metrics.jsonl')
  const metrics = await readJsonlTail(metPath, 220)
  const under = metrics.filter((m) => Number(m?.policyVersion) === targetVersion)
  const finals = under.map((m) => Number(m?.finalConfidence)).filter((x) => Number.isFinite(x))
  if (finals.length < minSamples()) return { rolledBack: false, reason: 'insufficient_samples' }

  const avg = finals.reduce((a, b) => a + b, 0) / finals.length
  if (avg >= baseline - dropThreshold()) return { rolledBack: false, reason: 'within_tolerance' }

  const r = await restoreManagerPolicyFromPrevious(dir)
  if (!r.ok) return { rolledBack: false, reason: r.message }

  await appendRollout(dir, {
    kind: 'auto_rollback',
    revertedFromVersion: targetVersion,
    observedAvgFinalConfidence: Math.round(avg * 1000) / 1000,
    baselineAvgFinalConfidence: baseline,
    sampleCount: finals.length
  })
  return { rolledBack: true, reason: 'regression_vs_baseline' }
}
