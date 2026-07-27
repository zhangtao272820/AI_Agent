import { isMultiSourceDataPipeline } from './dbPipelineDeterministic'
import { wantsNarrativeReportSynth, type SynthShapeContext } from './synthShapePolicy'

/** 叙述性/多源报告由 Synth 流式生成，report 步骤可跳过 LLM */
export function shouldDeferReportToSynth(
  results: Record<string, unknown>,
  ctx: SynthShapeContext = {},
): boolean {
  if (String(process.env.MANAGER_DEFER_REPORT_TO_SYNTH ?? '1').trim() === '0') return false
  if (isMultiSourceDataPipeline(results)) return true
  return wantsNarrativeReportSynth(ctx)
}

export function deferredReportEvidence(query: string) {
  return { kind: 'report' as const, query, mode: 'deferred_to_synth' as const }
}

/** plan 步已 defer 或当前任务应由 Synth 写报告（勿再跑内置 report LLM） */
export function isReportDeferredToSynth(
  results: Record<string, unknown>,
  evidence?: unknown[],
  ctx: SynthShapeContext = {},
): boolean {
  if (shouldDeferReportToSynth(results, ctx)) return true
  const ev = Array.isArray(evidence) ? evidence : []
  return ev.some(
    (e) =>
      String((e as { kind?: string })?.kind ?? '') === 'report' &&
      String((e as { mode?: string })?.mode ?? '') === 'deferred_to_synth'
  )
}

/** multi 意图：计划步 visualize 仅做结构层修复，Code 权威 LLM 出图统一交由 Synth 协作增强（避免重复 LLM + skip） */
export function shouldDeferVisualizeToSynthCollab(intent: string): boolean {
  if (String(process.env.MANAGER_VISUALIZE_DEFER_TO_SYNTH ?? '1').trim() === '0') return false
  return String(intent || '').trim() === 'multi'
}

export function deferredVisualizeCollabEvidence(query: string) {
  return { kind: 'visualize' as const, query, mode: 'deferred_to_internal_collab' as const }
}
