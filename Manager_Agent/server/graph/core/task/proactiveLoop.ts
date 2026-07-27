import fs from 'node:fs/promises'
import path from 'node:path'
import {
  loadTaskStack,
  sortTaskItems,
  upsertTaskStackItem,
  type TaskPriority,
  type TaskStackItem
} from './taskStack'
import {
  isNudgeKeyDismissed,
  loadTaskStackSuppressions,
  proactiveNudgeLogicalKey,
  dismissProactiveNudgeKey
} from './taskStackSuppressions'
import { lowScoreRunsForSession } from '../unifiedLearning'
import { staleUserGoalsForProactive } from './userGoals'
import { listSessionsForUser } from './userIdentity'

export type ProactiveNudge = {
  id: string
  sessionId: string
  taskId?: string
  userGoalId?: string
  title: string
  reason: 'overdue' | 'stale_active' | 'paused_resume' | 'low_composite_score' | 'user_goal'
  message: string
  priority: TaskPriority
  createdAt: string
  consumed?: boolean
}

const NUDGE_DIR = 'proactive-nudges'

export function isProactiveLoopEnabled() {
  return String(process.env.MANAGER_PROACTIVE_LOOP ?? '1').trim() !== '0'
}

function staleActiveMs() {
  const n = Number(process.env.MANAGER_PROACTIVE_STALE_MS ?? 86_400_000)
  return Number.isFinite(n) && n >= 3_600_000 ? Math.min(7 * 86_400_000, Math.floor(n)) : 86_400_000
}

function nudgePath(policyDir: string, sessionId: string) {
  return path.join(policyDir, NUDGE_DIR, `${sessionId}.json`)
}

export async function listTaskStackSessionIds(policyDir: string): Promise<string[]> {
  const dir = path.join(policyDir, 'task-stacks')
  try {
    const files = await fs.readdir(dir)
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
  } catch {
    return []
  }
}

async function readNudges(policyDir: string, sessionId: string): Promise<ProactiveNudge[]> {
  try {
    const raw = await fs.readFile(nudgePath(policyDir, sessionId), 'utf8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as ProactiveNudge[]) : []
  } catch {
    return []
  }
}

async function writeNudges(policyDir: string, sessionId: string, nudges: ProactiveNudge[]) {
  await fs.mkdir(path.join(policyDir, NUDGE_DIR), { recursive: true }).catch(() => undefined)
  await fs.writeFile(nudgePath(policyDir, sessionId), JSON.stringify(nudges.slice(0, 12), null, 2), 'utf8')
}

function nudgeId(sessionId: string, reason: string, taskId?: string) {
  return `nudge_${sessionId.slice(0, 8)}_${reason}_${taskId || 'general'}_${Date.now()}`
}

function analyzeTask(task: TaskStackItem): ProactiveNudge | null {
  const sid = ''
  const now = Date.now()
  if (task.status === 'done') return null
  if (task.deadline) {
    const ms = Date.parse(task.deadline)
    if (Number.isFinite(ms) && ms < now) {
      return {
        id: nudgeId('', 'overdue', task.id),
        sessionId: sid,
        taskId: task.id,
        title: task.title,
        reason: 'overdue',
        message: `任务「${task.title}」已逾期，建议恢复推进或调整截止时间。`,
        priority: task.priority,
        createdAt: new Date().toISOString()
      }
    }
  }
  if (task.status === 'paused') {
    return {
      id: nudgeId('', 'paused', task.id),
      sessionId: sid,
      taskId: task.id,
      title: task.title,
      reason: 'paused_resume',
      message: `任务「${task.title}」处于暂停状态，可在任务栈中点击「恢复」后继续。`,
      priority: task.priority,
      createdAt: new Date().toISOString()
    }
  }
  const updated = Date.parse(task.updatedAt || '')
  if (task.status === 'active' && Number.isFinite(updated) && now - updated > staleActiveMs()) {
    if (task.priority === 'critical' || task.priority === 'high') {
      return {
        id: nudgeId('', 'stale', task.id),
        sessionId: sid,
        taskId: task.id,
        title: task.title,
        reason: 'stale_active',
        message: `高优先级任务「${task.title}」已超过 24h 未更新，是否需要继续分解执行？`,
        priority: task.priority,
        createdAt: new Date().toISOString()
      }
    }
  }
  return null
}

export async function scanSessionProactiveNudges(policyDir: string, sessionId: string): Promise<ProactiveNudge[]> {
  if (!isProactiveLoopEnabled()) return []
  const sid = String(sessionId || '').trim()
  if (!sid) return []

  const stack = await loadTaskStack(policyDir, sid)
  const nudges: ProactiveNudge[] = []
  for (const task of sortTaskItems(stack.items)) {
    const n = analyzeTask(task)
    if (n) nudges.push({ ...n, sessionId: sid, id: nudgeId(sid, n.reason, task.id) })
  }

  const lowRuns = await lowScoreRunsForSession(policyDir, sid, 2)
  for (const run of lowRuns) {
    nudges.push({
      id: nudgeId(sid, 'low_score', run.runId),
      sessionId: sid,
      title: `改进 run ${run.runId.slice(0, 8)}`,
      reason: 'low_composite_score',
      message: `上一轮综合质量分较低（${run.compositeScore}），建议针对 ${run.failureCategory || run.intent} 补充约束或重试。`,
      priority: 'high',
      createdAt: new Date().toISOString()
    })
  }

  const deduped: ProactiveNudge[] = []
  const seen = new Set<string>()
  for (const n of nudges) {
    const key = `${n.reason}|${n.taskId || n.title}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(n)
  }
  return deduped.slice(0, 8)
}

export async function refreshProactiveNudgesForSession(policyDir: string, sessionId: string) {
  const next = await scanSessionProactiveNudges(policyDir, sessionId)
  const prev = await readNudges(policyDir, sessionId)
  const suppressions = await loadTaskStackSuppressions(policyDir, sessionId)
  const consumed = new Set([
    ...prev.filter((n) => n.consumed).map((n) => proactiveNudgeLogicalKey(n)),
    ...suppressions.dismissedNudgeKeys
  ])
  const merged = next.map((n) => {
    const key = proactiveNudgeLogicalKey(n)
    if (consumed.has(key) || isNudgeKeyDismissed(suppressions, key)) {
      return { ...n, consumed: true }
    }
    return n
  })
  await writeNudges(policyDir, sessionId, merged)
  return merged.filter((n) => !n.consumed)
}

async function injectUserGoalNudges(policyDir: string) {
  const stale = await staleUserGoalsForProactive(policyDir, 12)
  for (const { userId, goal, reason } of stale) {
    const sessions = goal.linkedSessionIds.length
      ? goal.linkedSessionIds
      : await listSessionsForUser(policyDir, userId)
    const sid = sessions[0] || userId
    const existing = await readNudges(policyDir, sid)
    const msg =
      reason === 'overdue'
        ? `跨会话目标「${goal.title}」已逾期，建议在本会话或任务栈中推进。`
        : reason === 'paused'
          ? `跨会话目标「${goal.title}」处于暂停，可在用户目标面板恢复。`
          : `跨会话目标「${goal.title}」长期未更新，是否需要继续分解？`
    const n: ProactiveNudge = {
      id: nudgeId(sid, `user_goal_${reason}`, goal.id),
      sessionId: sid,
      userGoalId: goal.id,
      taskId: goal.id,
      title: goal.title,
      reason: 'user_goal',
      message: msg,
      priority: goal.priority,
      createdAt: new Date().toISOString()
    }
    const key = `${n.reason}|${n.userGoalId}`
    if (existing.some((x) => `${x.reason}|${x.userGoalId || x.taskId}` === key && !x.consumed)) continue
    await writeNudges(policyDir, sid, [...existing, n].slice(-12))
  }
}

export async function runProactiveLoopTick(policyDir: string): Promise<{ sessions: number; nudges: number }> {
  if (!isProactiveLoopEnabled()) return { sessions: 0, nudges: 0 }
  await injectUserGoalNudges(policyDir).catch(() => undefined)
  const ids = await listTaskStackSessionIds(policyDir)
  let nudges = 0
  for (const sid of ids) {
    const pending = await refreshProactiveNudgesForSession(policyDir, sid)
    nudges += pending.length
    for (const n of pending.filter((x) => x.reason === 'low_composite_score').slice(0, 1)) {
      await upsertTaskStackItem(policyDir, sid, {
        title: n.title,
        note: n.message,
        status: 'paused',
        priority: n.priority,
        source: 'assistant'
      }).catch(() => undefined)
    }
  }
  return { sessions: ids.length, nudges }
}

/** 轻量读：仅返回已写入且未 consume 的 nudge（HTTP GET / 侧栏轮询用） */
export async function getPendingProactiveNudges(policyDir: string, sessionId: string) {
  const sid = String(sessionId || '').trim()
  if (!sid) return []
  const all = await readNudges(policyDir, sid)
  return all.filter((n) => !n.consumed).slice(0, 8)
}

export async function markProactiveNudgeConsumed(policyDir: string, sessionId: string, nudgeId: string) {
  const all = await readNudges(policyDir, sessionId)
  const hit = all.find((n) => n.id === nudgeId)
  const next = all.map((n) => (n.id === nudgeId ? { ...n, consumed: true } : n))
  await writeNudges(policyDir, sessionId, next)
  if (hit) {
    await dismissProactiveNudgeKey(policyDir, sessionId, proactiveNudgeLogicalKey(hit)).catch(() => undefined)
  }
}

export function formatProactiveBlockForRouter(nudges: ProactiveNudge[]): string {
  const pending = nudges.filter((n) => !n.consumed).slice(0, 3)
  if (!pending.length) return ''
  return [
    '【主动推进提醒（系统检测到未完成高优先级事项，非用户新指令）】',
    ...pending.map((n, i) => `${i + 1}. ${n.message}`)
  ].join('\n')
}

export async function buildProactiveDashboard(policyDir: string) {
  const ids = await listTaskStackSessionIds(policyDir)
  let totalPending = 0
  for (const sid of ids.slice(0, 50)) {
    const n = await readNudges(policyDir, sid)
    totalPending += n.filter((x) => !x.consumed).length
  }
  return {
    enabled: isProactiveLoopEnabled(),
    sessionCount: ids.length,
    pendingNudges: totalPending
  }
}
