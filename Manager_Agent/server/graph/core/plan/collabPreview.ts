import { buildCleanPreviewSummary } from '#agent-shared/cleanPayload'
import { readChartTitle, readEchartsOptionJsonFromVisualizeText } from '#agent-shared/chartOption'
import { readReportBlock } from '#agent-shared/reportPlan'

export type CollabPreviewPayload = {
  agent: 'clean' | 'visualize' | 'report'
  summary: string
  factCount?: number
  sources?: string[]
  conflicts?: number
  mode?: string
}

export function buildCollabPreviewPayload(
  agent: 'clean' | 'visualize' | 'report',
  output: string,
  mode?: string
): CollabPreviewPayload | null {
  const text = String(output ?? '').trim()
  if (!text) return null

  if (agent === 'clean') {
    const preview = buildCleanPreviewSummary(text)
    if (!preview) return null
    return { agent, mode, ...preview }
  }

  if (agent === 'visualize') {
    const opt = readEchartsOptionJsonFromVisualizeText(text)
    const title = opt ? readChartTitle(opt) : ''
    if (!title) return null
    return { agent, mode, summary: title }
  }

  if (agent === 'report') {
    const body = readReportBlock(text) ?? text
    const line =
      body
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('---')) ?? ''
    if (!line) return null
    return {
      agent,
      mode,
      summary: line.length > 96 ? `${line.slice(0, 93)}…` : line
    }
  }

  return null
}

export function emitCollabPreview(
  sendEvent: (payload: { event: string; data: unknown; from?: string }) => void,
  agent: 'clean' | 'visualize' | 'report',
  output: string,
  mode?: string
): void {
  try {
    const preview = buildCollabPreviewPayload(agent, output, mode)
    if (!preview) return
    sendEvent({ event: 'collab_preview', data: preview, from: 'manager' })
  } catch {
    /* preview 不得阻塞主链路 */
  }
}
