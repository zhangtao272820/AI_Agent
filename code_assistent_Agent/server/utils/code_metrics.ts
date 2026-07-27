/**
 * Code Agent 执行路径观测（进程内计数 + .data 落盘）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCodeAgentEnv } from './code_agent_env'

export type CodeQueryPath = 'compute' | 'inspect' | 'edit' | 'script' | 'full' | 'retrieve'

export type CodeQueryMetricEvent = {
  path: CodeQueryPath
  ok: boolean
  ms?: number
  question?: string
  from_manager?: boolean
  tool_calls?: number
  reason?: string
}

const counters: Record<string, number> = {}

function metricsFile() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'code-query-metrics.jsonl')
}

export function recordCodeQueryMetric(ev: CodeQueryMetricEvent) {
  if (!getCodeAgentEnv().enableMetrics) return
  const key = `${ev.path}:${ev.ok ? 'ok' : 'fail'}`
  counters[key] = (counters[key] || 0) + 1
  try {
    const line = JSON.stringify({ ...ev, at: new Date().toISOString() })
    appendFileSync(metricsFile(), `${line}\n`, 'utf8')
  } catch {
    /* 观测失败不影响主链路 */
  }
}

export function getCodeQueryMetricCounters() {
  return { ...counters }
}

export function readRecentCodeMetrics(limit?: number): CodeQueryMetricEvent[] {
  const cap = limit ?? getCodeAgentEnv().metricsRecentLimit
  try {
    const file = metricsFile()
    if (!existsSync(file)) return []
    const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
    return lines
      .slice(-cap)
      .map((l) => {
        try {
          return JSON.parse(l) as CodeQueryMetricEvent
        } catch {
          return null
        }
      })
      .filter(Boolean) as CodeQueryMetricEvent[]
  } catch {
    return []
  }
}
