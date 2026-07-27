import type { AgentResult } from '../../../utils/agents/types'
import { extractCrawlerTableMarkdown } from '../../../utils/crawler/managerCrawlerTaskPayload'
import { isDbNoData } from '../runtime/runtimePersistence'
import type { Step } from '../../../utils/shared/taskPlan'

/** 任务是否要求最终回答带可核验来源（联网/抓取类） */
export function taskNeedsExternalSources(state: {
  intent?: string
  meta?: Record<string, unknown> | null
  plan?: Step[]
  taskPlan?: { steps?: Step[] } | null
}): boolean {
  const steps =
    (Array.isArray(state.taskPlan?.steps) && state.taskPlan!.steps!.length
      ? state.taskPlan!.steps
      : Array.isArray(state.plan)
        ? state.plan
        : []) as Step[]
  const agents = new Set(steps.map((s) => String(s?.agent || '')))
  if (Boolean(state.meta?.needsWebSearch)) return true
  if (agents.has('crawler')) return true
  return false
}

export function finalHasAgentResultSources(evidence?: Array<Record<string, unknown>>): boolean {
  const rows = Array.isArray(evidence) ? evidence : []
  for (const ev of rows) {
    const ar = ev?.agentResult as AgentResult | undefined
    if (ar?.sources?.length) return true
  }
  return false
}

function textHasHttpUrl(text: string): boolean {
  const t = String(text ?? '')
  return t.includes('http://') || t.includes('https://')
}

export function finalHasExternalSources(state: {
  final?: string
  results?: Record<string, unknown>
  evidence?: Array<Record<string, unknown>>
}): boolean {
  const text = String(state.final || '')
  if (textHasHttpUrl(text)) return true
  if (extractCrawlerTableMarkdown(text)) return true

  const crawlerOut = String(state.results?.crawler ?? '')
  if (textHasHttpUrl(crawlerOut) || extractCrawlerTableMarkdown(crawlerOut)) return true

  const evidence = Array.isArray(state.evidence) ? state.evidence : []
  for (const e of evidence) {
    if (String(e?.kind || '') !== 'crawler') continue
    const items = Array.isArray(e?.items) ? e.items : []
    if (items.some((it: any) => String(it?.url || '').trim().startsWith('http'))) return true
  }
  return false
}

function evidenceDbNonempty(evidence: Array<Record<string, unknown>>): boolean {
  for (const e of evidence) {
    if (String(e?.kind ?? '') !== 'db') continue
    if (e?.empty === false) return true
    const ar = e?.agentResult as AgentResult | undefined
    if (ar?.structured && (ar.structured as { empty?: boolean }).empty === false) return true
    if (ar?.ok === true && ar?.error_code !== 'empty_result') return true
  }
  return false
}

function textHasSubstantiveNumbers(text: string): boolean {
  for (const ch of String(text ?? '')) {
    if (ch >= '0' && ch <= '9') return true
  }
  return false
}

/** 查数类是否有实质数据（非空泛化） */
export function hasDbEvidenceInRun(state: {
  results?: Record<string, unknown>
  final?: string
  evidence?: Array<Record<string, unknown>>
}): boolean {
  const evidence = Array.isArray(state.evidence) ? state.evidence : []
  if (evidenceDbNonempty(evidence)) return true

  const dbOut = String(state.results?.db ?? '').trim()
  if (dbOut && !isDbNoData(dbOut)) return true

  const final = String(state.final ?? '')
  if (textHasSubstantiveNumbers(final) && !isDbNoData(final)) return true
  return false
}

export function assessEvidenceGate(state: {
  intent?: string
  meta?: Record<string, unknown> | null
  plan?: Step[]
  taskPlan?: { steps?: Step[] } | null
  final?: string
  results?: Record<string, unknown>
  evidence?: Array<Record<string, unknown>>
}): { pass: boolean; reason?: string } {
  const steps =
    (Array.isArray(state.taskPlan?.steps) && state.taskPlan!.steps!.length
      ? state.taskPlan!.steps
      : Array.isArray(state.plan)
        ? state.plan
        : []) as Step[]
  const agents = new Set(steps.map((s) => String(s?.agent || '')))

  if (taskNeedsExternalSources(state) && !finalHasExternalSources(state) && !finalHasAgentResultSources(state.evidence)) {
    return { pass: false, reason: '联网/抓取任务缺少可核验来源（URL 或 AgentResult.sources）' }
  }
  if (agents.has('db') && !hasDbEvidenceInRun(state)) {
    return { pass: false, reason: '查数任务未获得有效数据依据' }
  }
  if (agents.has('rag') && !agents.has('crawler') && !agents.has('db')) {
    const evidence = Array.isArray(state.evidence) ? state.evidence : []
    const ragAr = evidence
      .map((e) => e?.agentResult as AgentResult | undefined)
      .find((ar) => ar?.agent === 'rag')
    if (ragAr?.needs_clarify) {
      return { pass: false, reason: '知识库检索未获得可引用片段（needs_clarify）' }
    }
    const ragCites = evidence.some(
      (e) =>
        String(e?.kind || '') === 'rag' &&
        ((Array.isArray(e?.citations) && e.citations.length > 0) ||
          (Number(e?.hits) > 0 && Array.isArray(e?.sources) && e.sources.length > 0))
    )
    if (!ragCites && !finalHasAgentResultSources(evidence)) {
      return { pass: false, reason: '知识库检索未获得可引用片段' }
    }
  }
  return { pass: true }
}
