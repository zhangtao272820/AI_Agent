/**
 * 通用 Report 规划载荷（对称于 LlmChartPlan）。
 * LLM 负责语义规划；组装层只做结构与 evidence 校验。
 */

import type { CodeAuthorityPayload, CodeDownstreamConsistencyResult } from './codeAuthorityPayload'
import { assessDownstreamOrphanNumbers } from './codeDownstreamAudit'

export type ReportFinding = {
  claim: string
  evidence_keys: string[]
  display_values?: string[]
}

export type ReportPlan = {
  title: string
  executive_summary: string[]
  key_findings: ReportFinding[]
  risks: Array<{ text: string; because?: string }>
  recommendations: Array<{ action: string; priority?: 'high' | 'normal' }>
  appendix_table?: Array<{ label: string; value: string }>
  confidence?: number
}

function normKey(k: string): string {
  return String(k ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function factKeySet(facts: CodeFact[]): Set<string> {
  const out = new Set<string>()
  for (const f of facts) {
    const k = String(f.key ?? '').trim()
    if (k) out.add(normKey(k))
  }
  return out
}

/** 组装层：evidence_keys 必须 ⊆ Code facts */
export function validateReportPlanEvidence(
  plan: ReportPlan,
  payload: CodeAuthorityPayload
): { ok: boolean; reason?: string } {
  const keys = factKeySet(payload.facts)
  if (!keys.size && plan.key_findings.length) {
    return { ok: false, reason: 'no_code_facts' }
  }
  for (const finding of plan.key_findings) {
    const ev = Array.isArray(finding.evidence_keys) ? finding.evidence_keys : []
    if (!ev.length) return { ok: false, reason: 'missing_evidence_keys' }
    for (const ek of ev) {
      const nk = normKey(String(ek ?? ''))
      if (!nk || !keys.has(nk)) {
        return { ok: false, reason: `orphan_evidence_key:${ek}` }
      }
    }
  }
  return { ok: true }
}

function formatPriority(p?: string): string {
  return p === 'high' ? '（高优先级）' : ''
}

/** 确定性组装 <!--REPORT--> 块 */
export function assembleReportFromPlan(plan: ReportPlan, banner = ''): string {
  const prefix = banner ? `${banner.trim()}\n\n` : ''
  const title = String(plan.title ?? '').trim() || '分析报告'
  const summary = (Array.isArray(plan.executive_summary) ? plan.executive_summary : [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .slice(0, 4)
  const findings = (Array.isArray(plan.key_findings) ? plan.key_findings : []).slice(0, 6)
  const risks = (Array.isArray(plan.risks) ? plan.risks : []).slice(0, 4)
  const recs = (Array.isArray(plan.recommendations) ? plan.recommendations : []).slice(0, 5)
  const appendix = Array.isArray(plan.appendix_table) ? plan.appendix_table.slice(0, 12) : []

  const lines: string[] = [`# ${title}`, '']

  if (summary.length) {
    lines.push('## 核心结论', '')
    for (const s of summary) lines.push(`- ${s}`)
    lines.push('')
  }

  if (findings.length) {
    lines.push('## 关键发现', '')
    for (const f of findings) {
      const claim = String(f.claim ?? '').trim()
      if (!claim) continue
      const refs = (f.evidence_keys ?? []).join('、')
      const disp =
        Array.isArray(f.display_values) && f.display_values.length
          ? `（${f.display_values.join('；')}）`
          : ''
      lines.push(`- ${claim}${disp}${refs ? ` [依据: ${refs}]` : ''}`)
    }
    lines.push('')
  }

  if (risks.length) {
    lines.push('## 风险与不确定性', '')
    for (const r of risks) {
      const t = String(r.text ?? '').trim()
      if (!t) continue
      const because = String(r.because ?? '').trim()
      lines.push(because ? `- ${t}（${because}）` : `- ${t}`)
    }
    lines.push('')
  }

  if (recs.length) {
    lines.push('## 下一步建议', '')
    for (const r of recs) {
      const action = String(r.action ?? '').trim()
      if (!action) continue
      lines.push(`- ${action}${formatPriority(r.priority)}`)
    }
    lines.push('')
  }

  if (appendix.length) {
    lines.push('## 附录数据', '', '| 项目 | 数值 |', '|---|---:|')
    for (const row of appendix) {
      lines.push(`| ${String(row.label ?? '').trim()} | ${String(row.value ?? '').trim()} |`)
    }
    lines.push('')
  }

  const body = lines.join('\n').trim()
  return `${prefix}<!--REPORT-->\n${body}\n<!--/REPORT-->`
}

export function readReportBlock(text: string): string | null {
  const open = '<!--REPORT-->'
  const close = '<!--/REPORT-->'
  const s = String(text ?? '')
  const start = s.indexOf(open)
  if (start < 0) return null
  const end = s.indexOf(close, start + open.length)
  if (end < 0) return null
  return s.slice(start + open.length, end).trim()
}

/** 报告正文 [依据: key1、key2] 须 ⊆ Code facts；无引用时做孤儿数字校验 */
export function assessReportEvidenceInText(
  payload: CodeAuthorityPayload,
  reportText: string,
  opts?: { skipOrphanAudit?: boolean; extraAllowed?: Set<number> }
): { ok: boolean; reason?: string; coverage?: number } {
  const body = readReportBlock(reportText) ?? String(reportText ?? '')
  if (!body.trim()) return { ok: true, coverage: 1 }

  const keys = factKeySet(payload.facts)
  const citations: string[] = []
  const re = /\[依据:\s*([^\]]+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    for (const part of m[1]!.split(/[、,，]/)) {
      const k = String(part ?? '').trim()
      if (k) citations.push(k)
    }
  }

  if (!citations.length) {
    if (opts?.skipOrphanAudit) return { ok: true, coverage: payload.facts.length ? 0 : 1 }
    const orphanGate = assessDownstreamOrphanNumbers(payload, [body], { extraAllowed: opts?.extraAllowed })
    if (!orphanGate.pass) return { ok: false, reason: orphanGate.reason, coverage: 0 }
    return { ok: true, coverage: payload.facts.length ? 0 : 1 }
  }

  let valid = 0
  for (const c of citations) {
    const nk = normKey(String(c))
    if (!nk || !keys.has(nk)) {
      return { ok: false, reason: `report evidence 引用不存在的事实键：${c}`, coverage: valid / citations.length }
    }
    valid += 1
  }
  return { ok: true, coverage: citations.length ? valid / citations.length : 1 }
}

export function assessReportOutputStructural(
  payload: CodeAuthorityPayload,
  reportText: string,
  opts?: { skipOrphanAudit?: boolean; extraAllowed?: Set<number> }
): CodeDownstreamConsistencyResult {
  const check = assessReportEvidenceInText(payload, reportText, opts)
  if (!check.ok) {
    return { pass: false, reason: check.reason, retryIntent: 'report' }
  }
  if (opts?.skipOrphanAudit) return { pass: true }
  return assessDownstreamOrphanNumbers(payload, [reportText], { extraAllowed: opts?.extraAllowed })
}

/** executeInternalStep 门禁：失败时不应输出 REPORT 块 */
export function validateReportOutputAgainstCode(
  payload: CodeAuthorityPayload,
  reportText: string
): { ok: boolean; reason?: string; coverage?: number } {
  return assessReportEvidenceInText(payload, reportText)
}

export function stripInvalidReportBlock(reportText: string): string {
  const open = '<!--REPORT-->'
  const close = '<!--/REPORT-->'
  const s = String(reportText ?? '')
  const start = s.indexOf(open)
  if (start < 0) return s
  const end = s.indexOf(close, start + open.length)
  if (end < 0) return s
  const prefix = s.slice(0, start).trimEnd()
  const suffix = s.slice(end + close.length).trimStart()
  return [prefix, suffix].filter(Boolean).join('\n\n')
}
