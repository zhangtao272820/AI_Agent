import fs from 'node:fs/promises'
import path from 'node:path'

export type RouteWrongFeedbackEntry = {
  ts: string
  type: 'route_wrong'
  sessionId: string
  userId?: string
  runId: string
  turnId?: number
  userMessageIndex?: number
  userTask?: string
  cap?: string[]
  intent?: string
  comment?: string
  orchestratorSource?: string
  lintIssues?: string[]
}

function policyDataDir(): string {
  return path.join(process.cwd(), '.data')
}

/** 路由纠错反馈：进人工/CI 队列，不直接改 Bandit */
export async function appendRouteWrongFeedback(
  entry: Omit<RouteWrongFeedbackEntry, 'ts' | 'type'>
): Promise<void> {
  const dir = policyDataDir()
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
  const row: RouteWrongFeedbackEntry = {
    ts: new Date().toISOString(),
    type: 'route_wrong',
    ...entry
  }
  const p = path.join(dir, 'manager-route-feedback.jsonl')
  await fs.appendFile(p, `${JSON.stringify(row)}\n`, 'utf8')
}
