/**
 * A4：Verifier 完成判定（确定性，与 Step Observation 同源）。
 * LLM claim 核验仅作辅助信号；禁止只读 synth 散文定成败。
 */
import { z } from 'zod'

export const VerifierCompletionVerdictSchema = z.object({
  verdict: z.enum(['pass', 'evidence_insufficient', 'goal_uncovered', 'failed_steps']),
  outcome: z.enum(['completed', 'failed', 'needs_human']),
  failedStepIds: z.array(z.string()).default([]),
  note: z.string().max(400).default('')
})

export type VerifierCompletionVerdict = z.infer<typeof VerifierCompletionVerdictSchema>

export type StepObservationRecord = {
  id?: string
  agent?: string
  status?: string
  error?: string
  output?: string
  optional?: boolean
  needsClarify?: boolean
}

const FAIL_STATUSES = new Set(['error', 'failed'])
const SKIP_STATUSES = new Set(['skipped', 'needs_replan'])
const OK_STATUSES = new Set(['ok', 'success', 'done', 'completed'])

function normStatus(s: string): string {
  return String(s || '').trim().toLowerCase()
}

/** 从 plan + byId / lastStepRecords 组装 Observation 列表 */
export function collectStepObservations(input: {
  plan?: Array<{ id?: string; agent?: string; query?: string; optional?: boolean }>
  stepRecords?: StepObservationRecord[]
  meta?: Record<string, unknown>
}): StepObservationRecord[] {
  const fromMeta = Array.isArray(input.meta?.lastStepRecords)
    ? (input.meta!.lastStepRecords as StepObservationRecord[])
    : Array.isArray(input.meta?.stepRecords)
      ? (input.meta!.stepRecords as StepObservationRecord[])
      : []
  const records = Array.isArray(input.stepRecords) && input.stepRecords.length ? input.stepRecords : fromMeta
  const plan = Array.isArray(input.plan) ? input.plan : []
  if (!plan.length && !records.length) return []

  const byId = new Map(records.map((r) => [String(r.id || '').trim(), r]))
  if (plan.length) {
    return plan.map((s, i) => {
      const id = String(s.id || `step_${i + 1}`).trim()
      const rec = byId.get(id)
      return {
        id,
        agent: String(s.agent || rec?.agent || ''),
        status: String(rec?.status || 'unknown'),
        error: rec?.error,
        output: rec?.output,
        optional: Boolean(s.optional ?? rec?.optional),
        needsClarify: Boolean(rec?.needsClarify)
      }
    })
  }
  return records.map((r, i) => ({
    id: String(r.id || `step_${i + 1}`),
    agent: String(r.agent || ''),
    status: String(r.status || 'unknown'),
    error: r.error,
    output: r.output,
    optional: Boolean(r.optional),
    needsClarify: Boolean(r.needsClarify)
  }))
}

/**
 * 确定性完成判定：步 Observation 优先于 claim rate。
 * 单跳 / 无步记录时返回 null（不强制结构化裁决）。
 */
export function assessVerifierCompletion(input: {
  intent?: string
  plan?: Array<{ id?: string; agent?: string; optional?: boolean }>
  stepRecords?: StepObservationRecord[]
  evidence?: Array<{ kind?: string }>
  evidenceSupportedClaimRate?: number | null
  unsupportedClaims?: string[]
  meta?: Record<string, unknown>
}): VerifierCompletionVerdict | null {
  const observations = collectStepObservations(input)
  const plan = Array.isArray(input.plan) ? input.plan : []
  const intent = String(input.intent || '').trim()
  const isMulti = intent === 'multi' || plan.length > 1 || observations.length > 1
  if (!isMulti) return null

  if (Boolean(input.meta?.forcePlanRollback) || Boolean(input.meta?.planPreviewCancelled)) {
    return {
      verdict: 'goal_uncovered',
      outcome: 'needs_human',
      failedStepIds: [],
      note: input.meta?.forcePlanRollback
        ? '局部修订超阈，已回退 Plan Mode，需人工再批'
        : '计划已取消，需人工确认后重跑'
    }
  }
  if (Boolean(input.meta?.needsClarify)) {
    return {
      verdict: 'goal_uncovered',
      outcome: 'needs_human',
      failedStepIds: [],
      note: '需要澄清后才能判定完成'
    }
  }

  const required = observations.filter((o) => !o.optional)
  const failed = required.filter((o) => FAIL_STATUSES.has(normStatus(String(o.status || ''))))
  const skipped = required.filter((o) => SKIP_STATUSES.has(normStatus(String(o.status || ''))))
  const ok = required.filter((o) => OK_STATUSES.has(normStatus(String(o.status || ''))))
  const unknown = required.filter((o) => {
    const st = normStatus(String(o.status || ''))
    return !FAIL_STATUSES.has(st) && !SKIP_STATUSES.has(st) && !OK_STATUSES.has(st)
  })

  const failedStepIds = failed.map((o) => String(o.id || '')).filter(Boolean)
  const activeN = Math.max(1, required.length - skipped.length)

  const isClarifyFail = (o: StepObservationRecord) =>
    Boolean(o.needsClarify) ||
    String(o.error || '').toLowerCase() === 'needs_clarify' ||
    /needs_clarify/i.test(String(o.error || ''))

  // 失败步全部为缺槽澄清：走可追问路径，避免 failed_steps 死胡同
  if (failed.length && failed.every(isClarifyFail)) {
    return {
      verdict: 'goal_uncovered',
      outcome: 'needs_human',
      failedStepIds,
      note: `需补充信息后继续（${failedStepIds.join(', ') || failed.length}）`
    }
  }

  // 仅 admin 写失败且其它关键步已成功：部分成功，提示改计划/重试写操作（非澄清）
  if (failed.length) {
    const onlyAdminHardFail =
      failed.every((o) => String(o.agent || '') === 'admin' && !isClarifyFail(o)) &&
      ok.length > 0 &&
      failed.length < activeN
    if (onlyAdminHardFail) {
      return {
        verdict: 'failed_steps',
        outcome: 'needs_human',
        failedStepIds,
        note: `数据步骤已完成；写操作失败（${failedStepIds.join(', ') || 'admin'}），可改计划或补参后重跑`
      }
    }
  }

  if (failed.length && failed.length >= activeN) {
    return {
      verdict: 'failed_steps',
      outcome: 'failed',
      failedStepIds,
      note: `关键步骤失败 ${failed.length}/${activeN}`
    }
  }
  if (failed.length) {
    return {
      verdict: 'failed_steps',
      outcome: 'needs_human',
      failedStepIds,
      note: `部分步骤失败（${failedStepIds.join(', ') || failed.length}），需人工或改计划`
    }
  }

  const evidenceN = (Array.isArray(input.evidence) ? input.evidence : []).filter((e) =>
    String(e?.kind || '').trim()
  ).length
  const claimRate =
    typeof input.evidenceSupportedClaimRate === 'number' && Number.isFinite(input.evidenceSupportedClaimRate)
      ? Number(input.evidenceSupportedClaimRate)
      : null
  const unsupported = Array.isArray(input.unsupportedClaims) ? input.unsupportedClaims : []

  if (required.length > 0 && ok.length === 0 && skipped.length >= required.length) {
    return {
      verdict: 'goal_uncovered',
      outcome: 'needs_human',
      failedStepIds: [],
      note: '关键步骤均被跳过，目标未覆盖'
    }
  }
  if (unknown.length && ok.length === 0 && !evidenceN) {
    return {
      verdict: 'goal_uncovered',
      outcome: 'needs_human',
      failedStepIds: [],
      note: '缺少可用步状态与证据'
    }
  }
  if (!evidenceN && ok.length === 0) {
    return {
      verdict: 'evidence_insufficient',
      outcome: 'needs_human',
      failedStepIds: [],
      note: '无 evidence，无法独立确认完成'
    }
  }
  if (claimRate !== null && claimRate < 0.45 && unsupported.length > 0) {
    return {
      verdict: 'evidence_insufficient',
      outcome: 'needs_human',
      failedStepIds: [],
      note: `宣称完成但证据支持率偏低（${claimRate.toFixed(2)}）`
    }
  }

  return {
    verdict: 'pass',
    outcome: 'completed',
    failedStepIds: [],
    note: evidenceN ? '步状态与证据一致，通过' : '步状态通过'
  }
}

/** 报告 outcome 与步失败冲突时返回提示文案 */
export function verifierReportConflictNote(
  outcome: 'completed' | 'failed' | 'needs_human',
  steps: Array<{ status?: string }>
): string | null {
  const hasFail = steps.some((s) => FAIL_STATUSES.has(normStatus(String(s.status || ''))))
  if (outcome === 'completed' && hasFail) {
    return '报告与步状态冲突：存在失败步，以步状态为准'
  }
  return null
}
