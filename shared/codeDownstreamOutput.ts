import { buildCodeFirstBundle, type ExtractPayloadFn } from './codeFirstAuthority'
import {
  buildDeterministicReportFromCode,
  buildVisualizeFromEmbeddedChart,
  codePayloadSupportsDeterministicReport,
  codePayloadSupportsDeterministicVisualize,
  resolveCodeAuthorityPayload
} from './codeAuthorityPayload'
import { tryDeterministicReportFromCodeFacts, tryDeterministicReportFromDbResults, isMultiSourceDataPipeline } from './dbPipelineDeterministic'
import { wantsNarrativeReportSynth, type SynthShapeContext } from './synthShapePolicy'

export type DownstreamKind = 'visualize' | 'report'

/** 有 Code 时：report 可确定性；visualize 仅内嵌 echarts 时确定性（其余走启发模型） */
export function tryDeterministicDownstreamOutput(
  kind: DownstreamKind,
  results: Record<string, unknown>,
  extractPayload?: ExtractPayloadFn,
  shapeCtx: SynthShapeContext = {}
): string | null {
  const payload = resolveCodeAuthorityPayload(results, extractPayload)
  if (!payload) return null

  if (kind === 'report') {
    const narrative = wantsNarrativeReportSynth(shapeCtx)
    const multiSource = isMultiSourceDataPipeline(results)
    if (!narrative && !multiSource) {
      if (extractPayload) {
        const fromDb = tryDeterministicReportFromDbResults(results, extractPayload)
        if (fromDb) return fromDb
        const generic = tryDeterministicReportFromCodeFacts(results, extractPayload)
        if (generic) return generic
      }
      if (!codePayloadSupportsDeterministicReport(payload)) return null
      const banner = buildCodeFirstBundle({ results, extractPayload, maxCodeChars: 400, maxRefChars: 0 }).authorityBanner
      return buildDeterministicReportFromCode(payload, banner)
    }
    return null
  }

  if (!codePayloadSupportsDeterministicVisualize(payload)) return null
  const banner = buildCodeFirstBundle({ results, extractPayload, maxCodeChars: 400, maxRefChars: 0 }).authorityBanner
  return buildVisualizeFromEmbeddedChart(payload, banner)
}
