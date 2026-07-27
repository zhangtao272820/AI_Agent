/**
 * Code NLU / TaskUnderstand 观测（C1-5）
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCodeAgentEnv } from './code_agent_env'
import type { CodeTaskKind } from './manager_task'

export type CodeNluMetricEvent = {
  task_kind?: CodeTaskKind
  source?: 'llm' | 'manager' | 'fallback'
  confidence?: number
  ok: boolean
  hint_files?: string[]
  write_allowed?: boolean
  question?: string
  rationale?: string
  reason?: string
}

function metricsFile() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'code-nlu-metrics.jsonl')
}

export function recordCodeNluMetric(ev: CodeNluMetricEvent) {
  if (!getCodeAgentEnv().enableMetrics) return
  try {
    const line = JSON.stringify({ ...ev, at: new Date().toISOString() })
    appendFileSync(metricsFile(), `${line}\n`, 'utf8')
  } catch {
    /* 观测失败不影响主链路 */
  }
}

export function readRecentCodeNluMetrics(limit?: number): CodeNluMetricEvent[] {
  const cap = limit ?? getCodeAgentEnv().metricsRecentLimit
  try {
    const file = metricsFile()
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-cap)
      .map((l) => {
        try {
          return JSON.parse(l) as CodeNluMetricEvent
        } catch {
          return null
        }
      })
      .filter(Boolean) as CodeNluMetricEvent[]
  } catch {
    return []
  }
}
