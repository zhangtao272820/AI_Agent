import { wrapTaggedBlock } from '../../../utils/shared/outputMarkers'
import { buildDeferredReportFromSynth } from '#agent-shared/deferredReportBlock'
import { isReportDeferredToSynth } from '#agent-shared/reportSynthDefer'

export function mergeSynthFinalWithReportBody(synth: string, reportBody: string): string {
  const body = String(reportBody || '').trim()
  let s = String(synth || '')
  if (!body || !/<!--\s*REPORT\s*-->/i.test(s)) return s

  const hasClose = /<!--\s*\/\s*REPORT\s*-->/i.test(s)
  if (hasClose) {
    const m = s.match(/<!--\s*REPORT\s*-->([\s\S]*?)<!--\s*\/\s*REPORT\s*-->/i)
    const inner = m ? String(m[1] || '').trim() : ''
    if (inner.length < 200 && body.length > inner.length + 40) {
      s = s.replace(/<!--\s*REPORT\s*-->[\s\S]*?<!--\s*\/\s*REPORT\s*-->/i, `<!--REPORT-->\n${body}\n<!--/REPORT-->`)
    }
  } else {
    s = s.replace(/<!--\s*REPORT\s*-->/i, `<!--REPORT-->\n${body}\n<!--/REPORT-->`)
  }

  const marker = '<!--/REPORT-->'
  const idx = s.indexOf(marker)
  if (idx >= 0) {
    const tail = s.slice(idx + marker.length).trimStart()
    const firstHeading = (t: string) =>
      String(t || '')
        .split('\n')
        .map((x) => x.trim())
        .find((l) => /^#{1,6}\s/.test(l)) || ''
    const hBody = firstHeading(body)
    const hTail = firstHeading(tail)
    if (hBody && hTail && hBody === hTail && tail.length > 40) {
      s = s.slice(0, idx + marker.length).trimEnd()
    }
  }
  return s
}

export function appendDeferredReportBlockIfNeeded(params: {
  body: string
  synthSource: string
  results: Record<string, unknown>
  evidence: unknown[]
  plannedReport: boolean
  shapeCtx?: { meta?: unknown; planSteps?: Array<{ agent?: string }> }
}): string {
  let out = String(params.body ?? '').trim()
  if (/<!--\s*REPORT\s*-->/i.test(out)) return out
  if (String(params.results?.report ?? '').trim()) return out
  if (
    !params.plannedReport &&
    !isReportDeferredToSynth(params.results, params.evidence, params.shapeCtx ?? {})
  ) {
    return out
  }
  const deferredBody = buildDeferredReportFromSynth(String(params.synthSource ?? '').trim())
  if (!deferredBody) return out
  return `${out}\n\n${wrapTaggedBlock('REPORT', deferredBody)}`.trim()
}
