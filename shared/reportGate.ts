import type { CodeAuthorityPayload } from './codeAuthorityPayload'
import { buildDeterministicReportFromCode } from './codeAuthorityPayload'
import {
  assessReportEvidenceInText,
  stripInvalidReportBlock,
  validateReportOutputAgainstCode
} from './reportPlan'
import { wantsNarrativeReportSynth } from './synthShapePolicy'

export type ReportGateResult = {
  output: string
  ok: boolean
  coverage?: number
  reason?: string
  mode?: 'original' | 'deterministic_fallback' | 'stripped'
}

/** P2-2：report 输出须通过 evidence / 孤儿数字校验；失败不保留 REPORT 块 */
export function gateReportOutput(
  payload: CodeAuthorityPayload,
  output: string,
  banner = '',
  question = '',
  meta?: unknown
): ReportGateResult {
  const text = String(output ?? '').trim()
  if (!text) return { output: '', ok: false, reason: 'empty_report' }

  const check = validateReportOutputAgainstCode(payload, text)
  if (check.ok) {
    return { output: text, ok: true, coverage: check.coverage, mode: 'original' }
  }

  const narrative = wantsNarrativeReportSynth({ meta })
  if (narrative || text.includes('<!--REPORT-->')) {
    return {
      output: stripInvalidReportBlock(text),
      ok: false,
      coverage: 0,
      reason: check.reason,
      mode: 'stripped'
    }
  }

  const det = buildDeterministicReportFromCode(payload, banner)
  const detCheck = assessReportEvidenceInText(payload, det)
  if (detCheck.ok) {
    return {
      output: det,
      ok: true,
      coverage: detCheck.coverage,
      mode: 'deterministic_fallback',
      reason: check.reason
    }
  }

  const stripped = stripInvalidReportBlock(text)
  return {
    output: stripped,
    ok: false,
    coverage: 0,
    reason: check.reason ?? detCheck.reason,
    mode: 'stripped'
  }
}
