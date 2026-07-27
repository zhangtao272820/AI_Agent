import fs from 'node:fs/promises'
import path from 'node:path'
import { listSessionsForUser, resolveUserId } from './userIdentity'

export type UserGoalPriority = 'critical' | 'high' | 'normal' | 'low'
export type UserGoalStatus = 'active' | 'paused' | 'done'

export type UserGoal = {
  id: string
  title: string
  note: string
  status: UserGoalStatus
  priority: UserGoalPriority
  deadline?: string
  linkedSessionIds: string[]
  createdAt: string
  updatedAt: string
}

export type UserGoalStore = {
  userId: string
  updatedAt: string
  goals: UserGoal[]
}

const MAX_GOALS = 32
const GOALS_DIR = 'user-goals'

const PRIORITY_WEIGHT: Record<UserGoalPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1
}

function nowIso() {
  return new Date().toISOString()
}

function goalsPath(policyDir: string, userId: string) {
  return path.join(policyDir, GOALS_DIR, `${userId}.json`)
}

function normalizePriority(v: unknown): UserGoalPriority {
  const s = String(v || '').trim().toLowerCase()
  if (s === 'critical' || s === 'high' || s === 'normal' || s === 'low') return s
  return 'normal'
}

function normalizeStatus(v: unknown): UserGoalStatus {
  const s = String(v || '').trim().toLowerCase()
  if (s === 'paused' || s === 'done') return s
  return 'active'
}

export function isUserGoalsEnabled() {
  return String(process.env.MANAGER_USER_GOALS ?? '1').trim() !== '0'
}

export function normalizeUserGoal(raw: unknown, fallbackId?: string): UserGoal | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const title = String(o.title || '').trim()
  if (!title) return null
  const ts = nowIso()
  const id = String(o.id || fallbackId || `ugoal_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`).trim()
  const deadlineRaw = String(o.deadline || '').trim()
  const linked = Array.isArray(o.linkedSessionIds)
    ? o.linkedSessionIds.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 12)
    : []
  return {
    id,
    title: title.slice(0, 240),
    note: String(o.note || '').trim().slice(0, 800),
    status: normalizeStatus(o.status),
    priority: normalizePriority(o.priority),
    deadline: deadlineRaw && !Number.isNaN(Date.parse(deadlineRaw)) ? deadlineRaw : undefined,
    linkedSessionIds: linked,
    createdAt: String(o.createdAt || ts),
    updatedAt: String(o.updatedAt || ts)
  }
}

export function sortUserGoals(goals: UserGoal[]): UserGoal[] {
  const statusOrder: Record<UserGoalStatus, number> = { active: 0, paused: 1, done: 2 }
  return [...goals].sort((a, b) => {
    const sa = statusOrder[a.status] ?? 9
    const sb = statusOrder[b.status] ?? 9
    if (sa !== sb) return sa - sb
    const pa = PRIORITY_WEIGHT[a.priority] ?? 0
    const pb = PRIORITY_WEIGHT[b.priority] ?? 0
    if (pa !== pb) return pb - pa
    const da = a.deadline ? Date.parse(a.deadline) : Number.MAX_SAFE_INTEGER
    const db = b.deadline ? Date.parse(b.deadline) : Number.MAX_SAFE_INTEGER
    if (da !== db) return da - db
    return Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || '')
  })
}

export async function loadUserGoals(policyDir: string, userId: string): Promise<UserGoalStore> {
  const uid = String(userId || '').trim()
  if (!uid) return { userId: '', updatedAt: nowIso(), goals: [] }
  try {
    const raw = await fs.readFile(goalsPath(policyDir, uid), 'utf8')
    const o = JSON.parse(raw)
    const goals = (Array.isArray(o?.goals) ? o.goals : [])
      .map((x: unknown, i: number) => normalizeUserGoal(x, `ugoal_${i}`))
      .filter(Boolean) as UserGoal[]
    return {
      userId: uid,
      updatedAt: String(o?.updatedAt || nowIso()),
      goals: sortUserGoals(goals).slice(0, MAX_GOALS)
    }
  } catch {
    return { userId: uid, updatedAt: nowIso(), goals: [] }
  }
}

async function saveUserGoals(policyDir: string, store: UserGoalStore): Promise<UserGoalStore> {
  await fs.mkdir(path.join(policyDir, GOALS_DIR), { recursive: true }).catch(() => undefined)
  const next: UserGoalStore = {
    userId: store.userId,
    updatedAt: nowIso(),
    goals: sortUserGoals(store.goals).slice(0, MAX_GOALS)
  }
  await fs.writeFile(goalsPath(policyDir, next.userId), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export async function linkSessionToUserGoals(
  policyDir: string,
  userId: string,
  sessionId: string
): Promise<UserGoalStore> {
  const store = await loadUserGoals(policyDir, userId)
  let changed = false
  const sid = String(sessionId || '').trim()
  if (!sid) return store
  const goals = store.goals.map((g) => {
    if (g.status === 'done') return g
    if (g.linkedSessionIds.includes(sid)) return g
    changed = true
    return {
      ...g,
      linkedSessionIds: [...g.linkedSessionIds, sid].slice(-12),
      updatedAt: nowIso()
    }
  })
  if (!changed) return store
  return saveUserGoals(policyDir, { ...store, goals })
}

export async function upsertUserGoal(
  policyDir: string,
  userId: string,
  goal: Partial<UserGoal> & { title: string },
  linkSessionId?: string
): Promise<UserGoalStore> {
  const store = await loadUserGoals(policyDir, userId)
  const normalized = normalizeUserGoal({ ...goal, id: goal.id })
  if (!normalized) return store
  const idx = store.goals.findIndex((g) => g.id === normalized.id)
  const goals = [...store.goals]
  const sid = String(linkSessionId || '').trim()
  if (idx >= 0) {
    const prev = goals[idx]
    const linked = new Set([...(prev.linkedSessionIds || []), ...(normalized.linkedSessionIds || [])])
    if (sid) linked.add(sid)
    goals[idx] = { ...prev, ...normalized, linkedSessionIds: [...linked].slice(-12), updatedAt: nowIso() }
  } else {
    const linked = new Set([...(normalized.linkedSessionIds || [])])
    if (sid) linked.add(sid)
    goals.push({ ...normalized, linkedSessionIds: [...linked].slice(-12) })
  }
  return saveUserGoals(policyDir, { ...store, goals })
}

export async function setUserGoalStatus(
  policyDir: string,
  userId: string,
  goalId: string,
  status: UserGoalStatus
): Promise<UserGoalStore> {
  const store = await loadUserGoals(policyDir, userId)
  const goals = store.goals.map((g) =>
    g.id === goalId ? { ...g, status, updatedAt: nowIso() } : g
  )
  return saveUserGoals(policyDir, { ...store, goals })
}

export async function deleteUserGoal(
  policyDir: string,
  userId: string,
  goalId: string
): Promise<UserGoalStore> {
  const store = await loadUserGoals(policyDir, userId)
  return saveUserGoals(policyDir, {
    ...store,
    goals: store.goals.filter((g) => g.id !== goalId)
  })
}

export async function listUserGoalUserIds(policyDir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(path.join(policyDir, GOALS_DIR))
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
  } catch {
    return []
  }
}

function priorityLabel(p: UserGoalPriority) {
  return ({ critical: '紧急', high: '高', normal: '普通', low: '低' } as const)[p] || p
}

function statusLabel(s: UserGoalStatus) {
  return ({ active: '进行中', paused: '已暂停', done: '已完成' } as const)[s] || s
}

function formatDeadlineLine(deadline?: string) {
  if (!deadline) return ''
  const ms = Date.parse(deadline)
  if (!Number.isFinite(ms)) return ''
  const overdue = ms < Date.now()
  const label = new Date(ms).toLocaleString('zh-CN', { hour12: false })
  return overdue ? `截止 ${label}（已逾期）` : `截止 ${label}`
}

export function formatUserGoalsBlockForRouter(goals: UserGoal[]): string {
  const active = sortUserGoals(goals).filter((g) => g.status !== 'done').slice(0, 6)
  if (!active.length) return ''
  const lines = active.map((g, i) => {
    const extra = [priorityLabel(g.priority), statusLabel(g.status), formatDeadlineLine(g.deadline)]
      .filter(Boolean)
      .join(' · ')
    const sessions = g.linkedSessionIds.length ? ` [关联会话:${g.linkedSessionIds.length}]` : ''
    return `${i + 1}. ${g.title}${sessions}（${extra}）${g.note ? ` — ${g.note.slice(0, 100)}` : ''}`
  })
  return [
    '【跨会话用户级目标（长期背景，非本轮新指令）】',
    '以下为该用户在多个会话中维护的长期目标；仅当用户本轮明确续接该目标时才对齐，否则以当前输入为准。',
    ...lines
  ].join('\n')
}

export function formatUserGoalsBlockForPlanner(goals: UserGoal[]): string {
  const active = sortUserGoals(goals).filter((g) => g.status === 'active').slice(0, 6)
  if (!active.length) return ''
  const lines = active.map((g, i) => {
    const extra = [priorityLabel(g.priority), formatDeadlineLine(g.deadline)].filter(Boolean).join(' · ')
    return `${i + 1}. ${g.title}（${extra}）${g.note ? `\n   说明：${g.note.slice(0, 200)}` : ''}`
  })
  return [
    '【用户级目标 — 规划对齐】',
    '仅当用户本轮明确续接 active 用户目标时，规划才应拆解为可执行步骤；deadline 更早者优先。',
    ...lines
  ].join('\n')
}

export async function buildUserGoalsRecall(
  policyDir: string,
  sessionId?: string,
  explicitUserId?: string
): Promise<{ routerText: string; plannerText: string; goals: UserGoal[]; userId: string | null }> {
  if (!isUserGoalsEnabled()) {
    return { routerText: '', plannerText: '', goals: [], userId: null }
  }
  const userId = await resolveUserId(policyDir, sessionId, explicitUserId)
  if (!userId) return { routerText: '', plannerText: '', goals: [], userId: null }
  if (sessionId) await linkSessionToUserGoals(policyDir, userId, sessionId).catch(() => undefined)
  const store = await loadUserGoals(policyDir, userId)
  return {
    routerText: formatUserGoalsBlockForRouter(store.goals),
    plannerText: formatUserGoalsBlockForPlanner(store.goals),
    goals: store.goals,
    userId
  }
}

export async function buildUserGoalsDashboard(policyDir: string, userId?: string) {
  if (!isUserGoalsEnabled()) return { enabled: false, userId: null, activeCount: 0, totalCount: 0 }
  const uid = userId ? String(userId) : null
  if (!uid) {
    const ids = await listUserGoalUserIds(policyDir)
    let active = 0
    let total = 0
    for (const id of ids.slice(0, 20)) {
      const s = await loadUserGoals(policyDir, id)
      total += s.goals.length
      active += s.goals.filter((g) => g.status === 'active').length
    }
    return { enabled: true, userCount: ids.length, activeCount: active, totalCount: total }
  }
  const store = await loadUserGoals(policyDir, uid)
  const sessions = await listSessionsForUser(policyDir, uid)
  return {
    enabled: true,
    userId: uid,
    activeCount: store.goals.filter((g) => g.status === 'active').length,
    totalCount: store.goals.length,
    overdueCount: store.goals.filter((g) => {
      if (g.status === 'done' || !g.deadline) return false
      return Date.parse(g.deadline) < Date.now()
    }).length,
    linkedSessionCount: sessions.length,
    recent: store.goals.filter((g) => g.status !== 'done').slice(0, 5)
  }
}

/** 供主动推进：跨会话逾期/暂停目标 */
export async function staleUserGoalsForProactive(policyDir: string, limit = 8) {
  const ids = await listUserGoalUserIds(policyDir)
  const out: Array<{ userId: string; goal: UserGoal; reason: 'overdue' | 'paused' | 'stale_active' }> = []
  const staleMs = Number(process.env.MANAGER_PROACTIVE_STALE_MS ?? 86_400_000)
  const now = Date.now()
  for (const uid of ids) {
    const store = await loadUserGoals(policyDir, uid)
    for (const g of store.goals) {
      if (g.status === 'done') continue
      if (g.deadline && Date.parse(g.deadline) < now) {
        out.push({ userId: uid, goal: g, reason: 'overdue' })
        continue
      }
      if (g.status === 'paused') {
        out.push({ userId: uid, goal: g, reason: 'paused' })
        continue
      }
      const updated = Date.parse(g.updatedAt || '')
      if (g.status === 'active' && Number.isFinite(updated) && now - updated > staleMs) {
        out.push({ userId: uid, goal: g, reason: 'stale_active' })
      }
    }
  }
  return out.slice(0, limit)
}
