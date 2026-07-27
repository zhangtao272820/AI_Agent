import fs from 'node:fs/promises'
import path from 'node:path'
import { broadcastToSession, isSessionWsOnline } from '../runtime/wsSessionHub'

export type AutonomousResultPayload = {
  jobId: string
  sessionId: string
  title: string
  kind: 'user_goal' | 'task_stack' | 'plan_step'
  ok: boolean
  finalText?: string
  error?: string
  ts: string
  deliveredLive?: boolean
}

const PENDING_DIR = 'autonomous-pending-notify'

function pendingPath(policyDir: string, sessionId: string) {
  return path.join(policyDir, PENDING_DIR, `${sessionId}.json`)
}

export function isAutonomousWsNotifyEnabled() {
  return String(process.env.MANAGER_AUTONOMOUS_WS_NOTIFY ?? '1').trim() !== '0'
}

async function readPending(policyDir: string, sessionId: string): Promise<AutonomousResultPayload[]> {
  try {
    const raw = await fs.readFile(pendingPath(policyDir, sessionId), 'utf8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as AutonomousResultPayload[]) : []
  } catch {
    return []
  }
}

async function writePending(policyDir: string, sessionId: string, items: AutonomousResultPayload[]) {
  const dir = path.join(policyDir, PENDING_DIR)
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(pendingPath(policyDir, sessionId), JSON.stringify(items.slice(-12), null, 2), 'utf8')
}

/** 自治 run 结束后：WS 实时推送 + 离线 pending（resume 时补发） */
export async function publishAutonomousResult(
  policyDir: string,
  payload: AutonomousResultPayload
): Promise<{ live: number; pending: number }> {
  if (!isAutonomousWsNotifyEnabled()) {
    return { live: 0, pending: 0 }
  }

  let live = 0
  if (isSessionWsOnline(payload.sessionId)) {
    live = broadcastToSession(payload.sessionId, {
      event: 'autonomous_result',
      data: payload,
      from: 'manager',
      runId: `auto-${payload.jobId}`
    })
  }

  const prev = await readPending(policyDir, payload.sessionId)
  const row = { ...payload, deliveredLive: live > 0 }
  await writePending(policyDir, payload.sessionId, [...prev, row])

  return { live, pending: prev.length + 1 }
}

/** resume / 重连时补发未读自治结果 */
export async function drainPendingAutonomousResults(
  policyDir: string,
  sessionId: string,
  opts?: { markDelivered?: boolean }
): Promise<AutonomousResultPayload[]> {
  const sid = String(sessionId || '').trim()
  if (!sid || !isAutonomousWsNotifyEnabled()) return []
  const pending = await readPending(policyDir, sid)
  if (!pending.length) return []
  if (opts?.markDelivered !== false) {
    await fs.unlink(pendingPath(policyDir, sid)).catch(() => undefined)
  }
  return pending
}
