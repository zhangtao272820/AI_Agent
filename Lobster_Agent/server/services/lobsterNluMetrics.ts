import fs from 'node:fs/promises'
import path from 'node:path'

export type LobsterNluMetricRow = {
  ts: number
  run_id?: string
  task_kind?: string
  engine_hint?: string
  engine_picked?: string
  browser_profile?: string
  confidence?: number
  /** understand | step_decide | step_decide_low_conf | heuristic_goals | … */
  source?: string
  needs_login?: boolean
  site_recipe_id?: string
  rationale?: string
}

function failureInsightsPath(): string {
  const dir = String(process.env.LOBSTER_STORAGE_DIR ?? '.data/lobster').trim() || '.data/lobster'
  return path.join(dir, 'lobster-failure-insights.jsonl')
}

export async function appendLobsterFailureInsight(row: {
  ts: number
  run_id?: string
  kind: string
  url?: string
  stage?: string
  detail?: string
}): Promise<void> {
  if (String(process.env.LOBSTER_NLU_METRICS ?? '1').trim() === '0') return
  try {
    const file = failureInsightsPath()
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, `${JSON.stringify(row)}\n`, 'utf-8')
  } catch {
    /* optional */
  }
}

function metricsPath(): string {
  const dir = String(process.env.LOBSTER_STORAGE_DIR ?? '.data/lobster').trim() || '.data/lobster'
  return path.join(dir, 'lobster-nlu-metrics.jsonl')
}

export async function appendLobsterNluMetric(row: LobsterNluMetricRow): Promise<void> {
  if (String(process.env.LOBSTER_NLU_METRICS ?? '1').trim() === '0') return
  try {
    const file = metricsPath()
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, `${JSON.stringify(row)}\n`, 'utf-8')
  } catch {
    /* optional observability */
  }
}
