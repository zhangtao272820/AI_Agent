/**
 * 结构化最终报告契约：目标 / 已执行 / 证据 / 失败跳过 / 后续建议。
 * 确定性组装，不依赖 LLM；单跳快路径可省略冗长区块。
 * A4：outcome 可由 VerifierCompletionVerdict 覆盖；步状态冲突时禁止写「完成」。
 */
import {
  assessVerifierCompletion,
  collectStepObservations,
  verifierReportConflictNote,
  type VerifierCompletionVerdict
} from './verifierCompletion'

export type StructuredRunReport = {
  goal: string
  outcome: 'completed' | 'failed' | 'needs_human'
  steps: Array<{ id: string; agent: string; status: string; query?: string }>
  evidence: string[]
  failures: string[]
  skipped: string[]
  nextActions: string[]
  /** Verifier 裁决码（可选） */
  verifierVerdict?: VerifierCompletionVerdict['verdict']
  /** 报告与步状态冲突提示 */
  conflictNote?: string
}

export function buildStructuredRunReport(input: {
  goal?: string
  intent?: string
  finalText?: string
  plan?: Array<{ id?: string; agent?: string; query?: string; optional?: boolean }>
  stepRecords?: Array<{ id?: string; agent?: string; status?: string; error?: string; output?: string; optional?: boolean }>
  evidence?: Array<{ kind?: string; query?: string }>
  meta?: Record<string, unknown>
  verifierVerdict?: VerifierCompletionVerdict | null
}): StructuredRunReport | null {
  const intent = String(input.intent || '').trim()
  const plan = Array.isArray(input.plan) ? input.plan : []
  const observations = collectStepObservations({
    plan,
    stepRecords: input.stepRecords,
    meta: input.meta
  })
  const isMulti = intent === 'multi' || plan.length > 1 || observations.length > 1
  if (!isMulti) return null

  const byId = new Map(observations.map((r) => [String(r.id || ''), r]))
  const steps = (plan.length ? plan : observations).map((s, i) => {
    const id = String((s as { id?: string }).id || `step_${i + 1}`)
    const rec = byId.get(id)
    const status = String(rec?.status || 'unknown')
    return {
      id,
      agent: String((s as { agent?: string }).agent || rec?.agent || ''),
      status,
      query: String((s as { query?: string }).query || '').slice(0, 160)
    }
  })

  const failures = steps
    .filter((s) => s.status === 'error' || s.status === 'failed')
    .map((s) => {
      const err = String(byId.get(s.id)?.error || '').trim()
      return err ? `${s.agent}: ${err.slice(0, 120)}` : `${s.agent} 失败`
    })
  const skipped = steps
    .filter((s) => s.status === 'skipped' || s.status === 'needs_replan')
    .map((s) => `${s.agent} 已跳过`)

  const evidence = (Array.isArray(input.evidence) ? input.evidence : [])
    .map((e) => {
      const kind = String(e?.kind || '').trim()
      const q = String(e?.query || '').trim()
      if (!kind) return ''
      return q ? `${kind}：${q.slice(0, 80)}` : kind
    })
    .filter(Boolean)
    .slice(0, 8)

  const verdict =
    input.verifierVerdict ||
    (input.meta?.verifierVerdict as VerifierCompletionVerdict | undefined) ||
    assessVerifierCompletion({
      intent,
      plan,
      stepRecords: observations,
      evidence: Array.isArray(input.evidence) ? input.evidence : [],
      evidenceSupportedClaimRate:
        typeof input.meta?.evidenceSupportedClaimRate === 'number'
          ? Number(input.meta.evidenceSupportedClaimRate)
          : null,
      unsupportedClaims: Array.isArray(input.meta?.unsupportedClaims)
        ? (input.meta!.unsupportedClaims as string[])
        : [],
      meta: input.meta
    })

  let outcome: StructuredRunReport['outcome'] = 'completed'
  if (verdict) {
    outcome = verdict.outcome
  } else {
    const cancelled = Boolean(input.meta?.planPreviewCancelled)
    const needsClarify = Boolean(input.meta?.needsClarify)
    if (cancelled || needsClarify) outcome = 'needs_human'
    else if (failures.length && failures.length >= Math.max(1, steps.length - skipped.length)) outcome = 'failed'
    else if (failures.length) outcome = 'needs_human'
  }

  // 硬约束：有失败步时禁止报告「完成」
  if (failures.length && outcome === 'completed') {
    outcome = failures.length >= Math.max(1, steps.length - skipped.length) ? 'failed' : 'needs_human'
  }

  const conflictNote = verifierReportConflictNote(outcome, steps) || undefined

  const nextActions: string[] = []
  if (Boolean(input.meta?.planPreviewCancelled)) nextActions.push('补充说明后重新提交任务')
  if (Boolean(input.meta?.forcePlanRollback)) nextActions.push('确认回退计划后重新执行剩余步骤')
  if (Boolean(input.meta?.needsClarify)) nextActions.push('回答澄清问题后继续')
  if (verdict?.verdict === 'evidence_insufficient') nextActions.push('补充证据或进入 Debug 定点重验')
  if (verdict?.verdict === 'goal_uncovered') nextActions.push('收紧计划或澄清目标后重跑')
  if (failures.length) nextActions.push('检查失败步骤的数据源或权限后重试')
  if (!nextActions.length && outcome === 'completed') nextActions.push('如需深挖，可指定下一步关注点')

  return {
    goal: String(input.goal || '').trim().slice(0, 240) || '（本轮任务）',
    outcome,
    steps,
    evidence,
    failures,
    skipped,
    nextActions: nextActions.slice(0, 4),
    ...(verdict ? { verifierVerdict: verdict.verdict } : {}),
    ...(conflictNote ? { conflictNote } : {})
  }
}

export function formatStructuredRunReportMarkdown(report: StructuredRunReport): string {
  const outcomeLabel =
    report.outcome === 'completed' ? '完成' : report.outcome === 'failed' ? '失败' : '需人工'
  const lines: string[] = [
    '## 执行摘要',
    `- 目标：${report.goal}`,
    `- 结果：${outcomeLabel}`,
  ]
  if (report.verifierVerdict) {
    lines.push(`- 判定：${report.verifierVerdict}`)
  }
  if (report.conflictNote) {
    lines.push(`- ⚠ ${report.conflictNote}`)
  }
  lines.push('', '### 已执行步骤')
  if (!report.steps.length) {
    lines.push('- （无步骤记录）')
  } else {
    for (const s of report.steps) {
      const st =
        s.status === 'ok' || s.status === 'success'
          ? '✓'
          : s.status === 'failed' || s.status === 'error'
            ? '×'
            : s.status === 'skipped' || s.status === 'needs_replan'
              ? '−'
              : '○'
      lines.push(`- ${st} ${s.agent}${s.query ? `：${s.query}` : ''}（${s.status}）`)
    }
  }
  if (report.evidence.length) {
    lines.push('', '### 证据')
    for (const e of report.evidence) lines.push(`- ${e}`)
  }
  if (report.failures.length) {
    lines.push('', '### 失败')
    for (const f of report.failures) lines.push(`- ${f}`)
  }
  if (report.skipped.length) {
    lines.push('', '### 跳过')
    for (const s of report.skipped) lines.push(`- ${s}`)
  }
  if (report.nextActions.length) {
    lines.push('', '### 后续建议')
    for (const n of report.nextActions) lines.push(`- ${n}`)
  }
  return lines.join('\n')
}

/** 将摘要附加到正文末尾（避免重复追加） */
export function appendStructuredReportIfNeeded(body: string, report: StructuredRunReport | null): string {
  const text = String(body || '').trim()
  if (!report) return text
  if (text.includes('## 执行摘要')) return text
  const block = formatStructuredRunReportMarkdown(report)
  if (!text) return block
  return `${text}\n\n---\n\n${block}`
}
