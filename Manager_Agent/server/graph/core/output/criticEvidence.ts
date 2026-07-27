import type { AgentResult } from '../../../utils/agents/types'

function collapse(text: string, max = 900): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** 为 Critic 审计构造「本轮证据」摘要（rag/db/crawler/code 等，与 agent 无关） */
export function formatEvidenceForCriticAudit(input: {
  evidence?: Array<Record<string, unknown>>
  results?: Record<string, unknown>
  maxChars?: number
}): string {
  const maxChars = input.maxChars ?? 4200
  const evidence = Array.isArray(input.evidence) ? input.evidence : []
  const results = input.results && typeof input.results === 'object' ? input.results : {}
  const lines: string[] = []
  const seen = new Set<string>()

  for (const e of evidence.slice(0, 10)) {
    const kind = String(e?.kind || '').trim()
    if (!kind || seen.has(kind)) continue
    seen.add(kind)
    if (kind === 'rag') {
      const citations = Array.isArray(e?.citations) ? e.citations : []
      const cites = citations
        .slice(0, 5)
        .map((c: any) => String(c?.source || c?.title || c?.url || '').trim())
        .filter(Boolean)
      const hits = Number(e?.hits) || 0
      lines.push(`rag：hits=${hits}；引用=${cites.join(' | ') || '（见子输出）'}`)
      const ragOut = collapse(String(results.rag ?? ''), 1000)
      if (ragOut) lines.push(`rag 子输出：${ragOut}`)
    } else if (kind === 'db') {
      lines.push(
        `db：query=${collapse(String(e?.query ?? ''), 120)}；empty=${Boolean(e?.empty)}；run_id=${String(e?.run_id ?? '')}`
      )
      const dbOut = collapse(String(results.db ?? ''), 1000)
      if (dbOut) lines.push(`db 子输出：${dbOut}`)
    } else if (kind === 'crawler') {
      const items = Array.isArray(e?.items) ? e.items : []
      const urls = items
        .slice(0, 4)
        .map((it: any) => String(it?.url || '').trim())
        .filter((u: string) => u.startsWith('http'))
      lines.push(`crawler：items=${items.length}；urls=${urls.join(' | ') || 'n/a'}`)
      const crawlerOut = collapse(String(results.crawler ?? ''), 800)
      if (crawlerOut) lines.push(`crawler 子输出：${crawlerOut}`)
    } else if (kind === 'gui') {
      const guiOut = collapse(String(results.gui ?? ''), 1000)
      const finalUrl = String((e?.agentResult as any)?.structured?.finalUrl || '').trim()
      lines.push(`gui：finalUrl=${finalUrl || 'n/a'}；items=${Number(e?.itemCount || 0)}`)
      if (guiOut) lines.push(`gui 子输出：${guiOut}`)
    } else if (kind === 'code') {
      lines.push(`code：threadId=${String(e?.threadId ?? '')}`)
      const codeOut = collapse(String(results.code ?? ''), 800)
      if (codeOut) lines.push(`code 子输出：${codeOut}`)
    } else {
      lines.push(`${kind}：（已记录 evidence）`)
    }
  }

  for (const key of ['rag', 'db', 'crawler', 'gui', 'code', 'clean', 'visualize', 'report'] as const) {
    if (seen.has(key)) continue
    const out = collapse(String(results[key] ?? ''), 600)
    if (out) lines.push(`${key} 子输出（无独立 evidence 行）：${out}`)
  }

  const arRows = evidence
    .map((e) => e?.agentResult as AgentResult | undefined)
    .filter((ar): ar is AgentResult => Boolean(ar?.agent))
  for (const ar of arRows.slice(0, 4)) {
    const src = (ar.sources || [])
      .slice(0, 3)
      .map((s) => String(s?.title || s?.url || '').trim())
      .filter(Boolean)
    if (src.length) lines.push(`${ar.agent} AgentResult.sources：${src.join(' | ')}`)
  }

  const body = lines.join('\n').trim()
  return body ? body.slice(0, maxChars) : '（本轮尚无结构化 evidence；仅可依据拟回答本身审计）'
}

export function formatEvaluatorForCriticAudit(evaluation: Record<string, unknown> | null | undefined): string {
  if (!evaluation || typeof evaluation !== 'object') return '评估器：（未运行）'
  const score = Number(evaluation.score ?? 0)
  const rec = String(evaluation.recommendation ?? '')
  const dataEv = Boolean(evaluation.hasDataEvidence)
  const implicit = Boolean(evaluation.hasImplicitDataEvidence)
  return `评估器：score=${score.toFixed(2)}；dataEvidence=${dataEv ? 'yes' : 'no'}；implicitData=${implicit ? 'yes' : 'no'}；recommend=${rec || 'n/a'}`
}

/**
 * Critic 要求重试，但评估器已确认本轮有数据依据且质量可接受 → 忽略改道重试。
 * 与 agent 类型无关（rag/db/crawler 等均适用）。
 */
export function criticRetryContradictsRunEvidence(input: {
  evaluation?: Record<string, unknown> | null
  minScore?: number
}): boolean {
  const score = Number(input.evaluation?.score ?? 0)
  const minScore = input.minScore ?? 0.8
  const hasData =
    Boolean(input.evaluation?.hasDataEvidence) || Boolean(input.evaluation?.hasImplicitDataEvidence)
  const rec = String(input.evaluation?.recommendation ?? '')
  if (!hasData || score < minScore) return false
  if (rec === 'clarify' || rec === 'retry') return false
  return true
}
