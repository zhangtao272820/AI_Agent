import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type ClauseDecomposeMetric = {
  ts: string
  sessionId?: string
  runId?: string
  mode: 'off' | 'llm' | 'skip'
  clauseCount: number
  agents: string[]
  ms?: number
  rollout?: boolean
}

function metricsFile() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'clause-decompose-metrics.jsonl')
}

export function appendClauseDecomposeMetric(row: ClauseDecomposeMetric): void {
  try {
    appendFileSync(metricsFile(), `${JSON.stringify(row)}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}
