import { textIncludesAny, DB_EMPTY_ANSWER_MARKERS } from './dbEmptyText'
import { wantsNarrativeReportSynth } from './synthShapePolicy'

const DETERMINISTIC_REPORT_MODES = new Set([
  'db_authority_deterministic',
  'code_authority_deterministic',
  'code_authority_llm',
  'deterministic'
])

/** report 步骤是否已由确定性路径生成（跳过 report/synth LLM 的依据） */
export function hasDeterministicReportEvidence(
  evidence?: Array<{ kind?: string; mode?: string }> | null
): boolean {
  if (!Array.isArray(evidence)) return false
  return evidence.some(
    (e) => String(e?.kind ?? '') === 'report' && DETERMINISTIC_REPORT_MODES.has(String(e?.mode ?? ''))
  )
}

/** 单源取数 + report 且 report 已确定性生成 → synth/critic 可直通 */
export function shouldPassthroughDeterministicReport(input: {
  planSteps?: Array<{ agent?: string }>
  results?: Record<string, unknown> | null
  evidence?: Array<{ kind?: string; mode?: string }> | null
  intent?: string
  question?: string
  meta?: unknown
}): boolean {
  const report = String(input.results?.report ?? '').trim()
  if (!report || !hasDeterministicReportEvidence(input.evidence)) return false

  if (wantsNarrativeReportSynth({ meta: input.meta, planSteps: input.planSteps })) return false
  if (!report.includes('<!--REPORT-->') && !report.includes('## 核心结论')) return false

  const steps = Array.isArray(input.planSteps) ? input.planSteps : []
  const agents = steps.map((s) => String(s?.agent ?? '')).filter(Boolean)
  if (!agents.includes('report')) return false

  const dataSources = ['db', 'rag', 'crawler', 'code'].filter((a) => agents.includes(a))
  if (dataSources.length > 1) return false

  const intent = String(input.intent ?? '').trim()
  if (intent === 'multi' && dataSources.length === 0) return false

  const blockers = ['admin', 'music', 'video', 'multimodal', 'visualize'].filter((a) => agents.includes(a))
  if (blockers.length) return false

  return true
}

/** 单源 DB 且库内已有非空结果 → chat 模式可直通；专业模式走 Synth LLM（流式+叙述） */
export function shouldPassthroughDbOnly(input: {
  intent?: string
  planSteps?: Array<{ agent?: string }>
  results?: Record<string, unknown> | null
  evidence?: Array<{ kind?: string; empty?: boolean }> | null
  meta?: unknown
  /** 专业工作台：禁止直通，须 Synth 归纳解释 */
  professionalMode?: boolean
}): boolean {
  if (input.professionalMode === true) return false
  const db = String(input.results?.db ?? '').trim()
  if (!db || db.length < 8) return false

  const steps = Array.isArray(input.planSteps) ? input.planSteps : []
  const stepAgents = steps.map((s) => String(s?.agent ?? '')).filter(Boolean)
  if (stepAgents.includes('report') || stepAgents.includes('clean') || stepAgents.includes('code')) return false
  if (wantsNarrativeReportSynth({ meta: input.meta, planSteps: input.planSteps })) return false

  const dbEv = (Array.isArray(input.evidence) ? input.evidence : []).find(
    (e) => String(e?.kind ?? '') === 'db'
  )
  if (dbEv?.empty) return false

  if (textIncludesAny(db, DB_EMPTY_ANSWER_MARKERS) && db.length < 120) return false

  const otherAgents = [
    'rag',
    'crawler',
    'code',
    'admin',
    'gui',
    'clean',
    'visualize',
    'report',
    'music',
    'video',
    'multimodal'
  ]
  const hasOtherOutput = otherAgents.some((a) => String(input.results?.[a] ?? '').trim().length > 0)
  if (hasOtherOutput) return false

  const intent = String(input.intent ?? '').trim()

  if (intent === 'db') return true

  if (intent === 'multi') {
    if (stepAgents.length === 0) return true
    if (stepAgents.length === 1 && stepAgents[0] === 'db') return true
    const dataAgents = ['db', 'rag', 'crawler', 'code'].filter((a) => stepAgents.includes(a))
    if (dataAgents.length === 1 && dataAgents[0] === 'db') return true
  }

  return false
}

/** 路由未含 crawler/媒体时 SERP 无下游，结构性跳过 web_search */
export function shouldSkipWebSearchStructurally(input: {
  allowedAgents?: string[]
  intent?: string
}): string | null {
  const agents = new Set(
    (Array.isArray(input.allowedAgents) ? input.allowedAgents : []).map((a) => String(a ?? '').trim()).filter(Boolean)
  )
  const hasSerpConsumer = agents.has('crawler') || agents.has('music') || agents.has('video')
  if (hasSerpConsumer) return null

  const intent = String(input.intent ?? '').trim()
  if (intent === 'db' || intent === 'rag') {
    return '路由无 crawler/媒体步骤，跳过 web_search（SERP 无下游）'
  }
  if (intent === 'multi' && (agents.has('db') || agents.has('rag')) && !hasSerpConsumer) {
    return '多步任务无 crawler/媒体，跳过 web_search'
  }
  return null
}
