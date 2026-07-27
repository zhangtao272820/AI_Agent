import type { ManagerGraphState } from '../../state/state'
import { structuralAnswerVerdict, isAnswerUsable } from '../agent/agentAnswerJudge'
import { extractStructuredPayload } from '../shared'
import { resolveLeanDbUserQuestion, isStructuredDatabaseAnchoredQuery, hasStrongDbAnchor } from '../text'

export const CTX_SEP = '\n\n已知信息（来自上游步骤，仅供事实参考）：\n'

export function resolveDbUserMessage(effQuery: string, lastUser: string): string {
  const parts = effQuery.split(CTX_SEP)
  if (parts.length > 1) {
    return `${resolveLeanDbUserQuestion(String(parts[0] || '').trim(), lastUser)}${CTX_SEP}${parts.slice(1).join(CTX_SEP)}`
  }
  return resolveLeanDbUserQuestion(effQuery, lastUser)
}

export function computePolicyDbTimeoutMs(input: {
  state: ManagerGraphState
  policy: { db: { timeoutMsMatched: number; timeoutMsUnmatched: number } }
  optsTimeoutMs: number
  question: string
  questionForDb: string
}): number {
  const { state, policy, optsTimeoutMs, question, questionForDb } = input
  const forceDbRun = state.forceIntent === 'db' || hasStrongDbAnchor(question)
  const generousDbTimeout =
    Boolean(state.probe?.db?.matched) ||
    forceDbRun ||
    state.intent === 'db' ||
    isStructuredDatabaseAnchoredQuery(questionForDb) ||
    isStructuredDatabaseAnchoredQuery(question)
  const plannedTimeout = generousDbTimeout ? policy.db.timeoutMsMatched : policy.db.timeoutMsUnmatched
  const capped = Math.min(optsTimeoutMs, Number(plannedTimeout || optsTimeoutMs))
  return Math.min(optsTimeoutMs, Math.max(generousDbTimeout ? 25_000 : 15_000, capped))
}

/** RAG 澄清协议标记（与 retrieval_shared.formatClarifyEnvelope 对齐，非语义正则） */
export function isRagClarifyProtocolText(text: string): boolean {
  const t = String(text ?? '').trim()
  if (!t) return true
  return t.includes('<RAG_NEEDS_CLARIFY>') || t.includes('【需要补充信息】')
}

export function hasUsableFactsFromText(text: string): boolean {
  if (isRagClarifyProtocolText(text)) return false
  const verdict = structuralAnswerVerdict(String(text || ''))
  if (verdict.reason === 'unstructured') {
    const facts = extractStructuredPayload(String(text || ''))
    if (Array.isArray(facts?.facts) && facts.facts.length > 0) return true
    return false
  }
  return isAnswerUsable(verdict)
}

/** 结构性统计 RAG 检索依据数量（不用问句关键词） */
export function countRagEvidenceUnits(
  evidence: Record<string, unknown> | null | undefined,
  probeRag?: { hits?: number; sources?: unknown; snippets?: unknown } | null
): number {
  let units = 0
  const hits = Number(evidence?.hits ?? probeRag?.hits ?? 0)
  if (Number.isFinite(hits) && hits > 0) units += hits
  if (Array.isArray(evidence?.citations)) units += evidence.citations.length
  if (Array.isArray(evidence?.sources)) units += evidence.sources.length
  if (Array.isArray(probeRag?.sources)) units += probeRag.sources.length
  if (Array.isArray(probeRag?.snippets)) units += probeRag.snippets.length
  return units
}

export const RAG_EMPTY_EVIDENCE_CLARIFY = [
  '请说明要检索的制度/手册/文档名称，或提供章节、关键词、时间范围等线索。',
  '若文档尚未入库，请先上传相关文件，或改问业务数据库中的结构化记录。'
] as const

export function isChatRevisionMeta(meta: unknown): boolean {
  const rev = String((meta as { chatRevision?: string } | undefined)?.chatRevision || '').trim()
  return rev === 'regenerate' || rev === 'edit_resend'
}

export function mergeRagClarifyQuestions(
  ragOut: string,
  ragClarify: { needsClarify: boolean; questions: string[] },
  evidenceUnits: number,
  agentNeedsClarify?: boolean
): string[] | undefined {
  if (agentNeedsClarify || ragClarify.needsClarify) {
    return ragClarify.questions.length ? ragClarify.questions : [...RAG_EMPTY_EVIDENCE_CLARIFY]
  }
  if (isRagClarifyProtocolText(ragOut)) {
    return ragClarify.questions.length ? ragClarify.questions : [...RAG_EMPTY_EVIDENCE_CLARIFY]
  }
  if (evidenceUnits === 0 && !hasUsableFactsFromText(ragOut)) return [...RAG_EMPTY_EVIDENCE_CLARIFY]
  return undefined
}

