/**
 * Synth / 执行模式形态判定：读 Plan / meta / 结果结构，禁止 HEAVY_TASK 词表硬分支。
 */
import type { IntentClassifyResult } from '../server/graph/llm/intentClassifyLlm'
import { intentClassifyFromMeta } from '../server/graph/llm/intentClassifyLlm'

export type SynthShapeSignals = {
  multiSourceSynth: boolean
  narrativeReport: boolean
  multiCompare: boolean
}

/** Plan / meta 上下文（替代问句词表） */
export type SynthShapeContext = {
  meta?: unknown
  planSteps?: Array<{ agent?: string }>
}

const HEAVY_AGENTS = new Set(['clean', 'visualize', 'report'])
const DATA_PLANE_AGENTS = new Set(['rag', 'db', 'crawler', 'admin', 'code'])

function metaRecord(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}
}

function classifyFrom(meta: unknown): IntentClassifyResult | null {
  return intentClassifyFromMeta(meta)
}

function agentsFromSteps(steps: Array<{ agent?: string }> | undefined): string[] {
  if (!Array.isArray(steps)) return []
  return steps.map((s) => String(s?.agent ?? '').trim()).filter(Boolean)
}

function countDataPlanes(agents: string[]): number {
  return agents.filter((a) => DATA_PLANE_AGENTS.has(a)).length
}

/** 多源结果管道（已有结构化检测） */
export function isMultiSourceDataPipeline(results: Record<string, unknown> | null | undefined): boolean {
  if (!results || typeof results !== 'object') return false
  const hits = ['db', 'rag', 'crawler', 'code'].filter((k) => String(results[k] ?? '').trim().length > 0)
  return hits.length >= 2
}

export function synthShapeFromPlanSteps(steps: Array<{ agent?: string }> | undefined): Partial<SynthShapeSignals> {
  const agents = agentsFromSteps(steps)
  const hasHeavy = agents.some((a) => HEAVY_AGENTS.has(a))
  const multiFetch = countDataPlanes(agents) >= 2
  return {
    multiSourceSynth: hasHeavy || multiFetch,
    narrativeReport: agents.includes('report'),
    multiCompare: agents.includes('report') && agents.includes('visualize') && multiFetch,
  }
}

export function synthShapeFromMeta(meta: unknown): Partial<SynthShapeSignals> {
  const m = metaRecord(meta)
  const classify = classifyFrom(meta)
  const taskShape = String(m.taskShape ?? '').trim()
  const multiParallel = taskShape === 'multi_source_parallel' || taskShape === 'linear_pipeline'
  return {
    multiSourceSynth:
      Boolean(m.requiresAgentPipelineHint) ||
      Boolean(m.wantsReportHint) ||
      Boolean(m.wantsVisualizeHint) ||
      multiParallel ||
      Boolean(classify?.isMulti),
    narrativeReport:
      Boolean(classify?.explicitWantsReport) ||
      Boolean(m.wantsReportHint) ||
      Boolean(classify?.explicitWantsVisualize && classify?.isMulti),
    multiCompare:
      Boolean(classify?.explicitWantsReport && classify?.explicitWantsVisualize) ||
      (Boolean(m.wantsReportHint) && Boolean(m.wantsVisualizeHint)),
  }
}

export function resolveSynthShapeSignals(input: {
  meta?: unknown
  planSteps?: Array<{ agent?: string }>
  results?: Record<string, unknown> | null
  multiSourcePipeline?: boolean
  /** 极长问句：结构性阈值，非业务词表 */
  questionLength?: number
}): SynthShapeSignals {
  const fromPlan = synthShapeFromPlanSteps(input.planSteps)
  const fromMeta = synthShapeFromMeta(input.meta)
  const pipeline = input.multiSourcePipeline ?? isMultiSourceDataPipeline(input.results ?? null)
  const longQuestion = (input.questionLength ?? 0) > 320

  return {
    multiSourceSynth: Boolean(
      pipeline || fromPlan.multiSourceSynth || fromMeta.multiSourceSynth || longQuestion,
    ),
    narrativeReport: Boolean(fromPlan.narrativeReport || fromMeta.narrativeReport),
    multiCompare: Boolean(fromPlan.multiCompare || fromMeta.multiCompare),
  }
}

/** 替代 looksLikeHeavyTaskText — 仅结构 + meta */
export function isHeavySynthTask(input: {
  meta?: unknown
  planSteps?: Array<{ agent?: string }>
  results?: Record<string, unknown> | null
  questionLength?: number
}): boolean {
  return resolveSynthShapeSignals(input).multiSourceSynth
}

/** 替代 looksLikeNarrativeReportRequest — 读编排 / classify，不读问句词表 */
export function wantsNarrativeReportSynth(input: { meta?: unknown; planSteps?: Array<{ agent?: string }> }): boolean {
  return resolveSynthShapeSignals({ meta: input.meta, planSteps: input.planSteps }).narrativeReport
}

/** 替代 looksLikeMultiCompareRequest */
export function wantsMultiCompareExecution(input: { meta?: unknown; planSteps?: Array<{ agent?: string }> }): boolean {
  return resolveSynthShapeSignals({ meta: input.meta, planSteps: input.planSteps }).multiCompare
}
