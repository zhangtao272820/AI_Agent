/** 总管消费 Code Agent WS meta / 澄清载荷 */
import type { CodeAgentMeta } from '../platform/agentClients'

export function parseCodeClarifyFromMeta(meta?: CodeAgentMeta | null): {
  needsClarify: boolean
  questions: string[]
  chips: string[]
} {
  if (!meta) return { needsClarify: false, questions: [], chips: [] }
  const needsClarify = Boolean(meta.needsClarify ?? meta.needs_clarification)
  const questions = Array.isArray(meta.clarifyQuestions)
    ? meta.clarifyQuestions.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 4)
    : Array.isArray(meta.questions)
      ? meta.questions.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 4)
      : []
  const chips = Array.isArray(meta.clarifyChips)
    ? meta.clarifyChips.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 6)
    : []
  return { needsClarify: needsClarify || questions.length > 0, questions, chips }
}

export function buildCodeEvidenceExtras(meta?: CodeAgentMeta | null) {
  if (!meta) return {}
  return {
    task_kind: meta.task_kind,
    files_touched: meta.files_touched,
    validate_ok: meta.validate_ok,
    tool_calls: meta.tool_calls,
  }
}

/** validate 失败或未写盘时，给 fix 节点的提示 */
export function buildCodeFixHintFromMeta(meta?: CodeAgentMeta | null): string | null {
  if (!meta) return null
  const parts: string[] = []
  if (meta.validate_ok === false) {
    parts.push('代码助手校验未通过，请优先修复 typecheck/lint 问题后再汇总')
    if (meta.files_touched?.length) parts.push(`涉及文件：${meta.files_touched.slice(0, 4).join(', ')}`)
  }
  if (meta.task_kind === 'edit' && meta.files_touched?.length && meta.validate_ok !== true) {
    parts.push('建议在原文件上 apply_diff 并重新 validate_project')
  }
  return parts.length ? parts.join('；') : null
}

export function codeResultNeedsManagerClarify(meta?: CodeAgentMeta | null) {
  return parseCodeClarifyFromMeta(meta).needsClarify
}
