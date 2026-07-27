import fs from 'node:fs/promises'
import path from 'node:path'
import { analyzeFailureInsights } from '../evolution/failureInsights'
import { loadActivePlannerRules } from '../evolution/plannerRules'
import { readTaskStackHybrid, writeTaskStackHybrid } from '../../../utils/shared/taskStackStore'
import {
  clearTaskStackDismissal,
  dismissProactiveNudgeKey,
  dismissTaskStackKeys,
  isTaskKeyDismissed,
  loadTaskStackSuppressions,
  proactiveNudgeLogicalKey
} from './taskStackSuppressions'

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low'
export type TaskStatus = 'active' | 'paused' | 'done'
export type TaskSource = 'manual' | 'assistant' | 'failure' | 'planner_rule' | 'user'

export type TaskStackItem = {
  id: string
  title: string
  note: string
  status: TaskStatus
  priority: TaskPriority
  deadline?: string
  source: TaskSource
  linkedFailureCategory?: string
  linkedPlannerRuleId?: string
  createdAt: string
  updatedAt: string
}

export type TaskStack = {
  sessionId: string
  updatedAt: string
  items: TaskStackItem[]
}

const MAX_ITEMS = 24
const STACK_DIR = 'task-stacks'

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1
}

function nowIso() {
  return new Date().toISOString()
}

function stackFilePath(policyDir: string, sessionId: string) {
  const sid = String(sessionId || '').trim()
  return path.join(policyDir, STACK_DIR, `${sid}.json`)
}

function normalizePriority(v: unknown): TaskPriority {
  const s = String(v || '').trim().toLowerCase()
  if (s === 'critical' || s === 'high' || s === 'normal' || s === 'low') return s
  return 'normal'
}

function normalizeStatus(v: unknown): TaskStatus {
  const s = String(v || '').trim().toLowerCase()
  if (s === 'paused' || s === 'done') return s
  return 'active'
}

function normalizeSource(v: unknown): TaskSource {
  const s = String(v || '').trim().toLowerCase()
  if (s === 'assistant' || s === 'failure' || s === 'planner_rule' || s === 'user') return s
  return 'manual'
}

export function normalizeTaskItem(raw: unknown, fallbackId?: string): TaskStackItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const title = String(o.title || '').trim()
  if (!title) return null
  const ts = nowIso()
  const id = String(o.id || fallbackId || `task_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`).trim()
  const deadlineRaw = String(o.deadline || '').trim()
  return {
    id,
    title: title.slice(0, 240),
    note: String(o.note || '').trim().slice(0, 600),
    status: normalizeStatus(o.status),
    priority: normalizePriority(o.priority),
    deadline: deadlineRaw && !Number.isNaN(Date.parse(deadlineRaw)) ? deadlineRaw : undefined,
    source: normalizeSource(o.source),
    linkedFailureCategory: String(o.linkedFailureCategory || '').trim() || undefined,
    linkedPlannerRuleId: String(o.linkedPlannerRuleId || '').trim() || undefined,
    createdAt: String(o.createdAt || ts),
    updatedAt: String(o.updatedAt || ts)
  }
}

export function sortTaskItems(items: TaskStackItem[]): TaskStackItem[] {
  const statusOrder: Record<TaskStatus, number> = { active: 0, paused: 1, done: 2 }
  return [...items].sort((a, b) => {
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

function normalizeStackItems(items: unknown[]): TaskStackItem[] {
  return sortTaskItems(
    items.map((x, i) => normalizeTaskItem(x, `task_${i}`)).filter(Boolean) as TaskStackItem[]
  ).slice(0, MAX_ITEMS)
}

export async function loadTaskStack(policyDir: string, sessionId: string): Promise<TaskStack> {
  const sid = String(sessionId || '').trim()
  if (!sid) return { sessionId: '', updatedAt: nowIso(), items: [] }
  const stack = await readTaskStackHybrid(sid, async () => {
    try {
      const raw = await fs.readFile(stackFilePath(policyDir, sid), 'utf8')
      const o = JSON.parse(raw)
      return {
        sessionId: sid,
        updatedAt: String(o?.updatedAt || nowIso()),
        items: normalizeStackItems(Array.isArray(o?.items) ? o.items : [])
      }
    } catch {
      return { sessionId: sid, updatedAt: nowIso(), items: [] }
    }
  })
  return {
    sessionId: sid,
    updatedAt: stack.updatedAt || nowIso(),
    items: normalizeStackItems(Array.isArray(stack.items) ? stack.items : [])
  }
}

export async function saveTaskStack(policyDir: string, stack: TaskStack): Promise<TaskStack> {
  const sid = String(stack.sessionId || '').trim()
  if (!sid) return stack
  const next: TaskStack = {
    sessionId: sid,
    updatedAt: nowIso(),
    items: sortTaskItems(stack.items).slice(0, MAX_ITEMS)
  }
  return writeTaskStackHybrid(next, async (s) => {
    const dir = path.join(policyDir, STACK_DIR)
    await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
    await fs.writeFile(stackFilePath(policyDir, sid), JSON.stringify(s, null, 2), 'utf8')
    return s
  })
}

/** 标题紧凑化（仅去标点/空白，不做语义改写） */
function compactTaskTitle(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** 结构相近的 active 项（完全同键或一方包含另一方），供 upsert 合并 */
function findMergeableActiveTask(items: TaskStackItem[], title: string): TaskStackItem | null {
  const probe = compactTaskTitle(title)
  if (probe.length < 6) return null
  for (const item of items) {
    if (item.status === 'done') continue
    const existing = compactTaskTitle(item.title)
    if (!existing) continue
    if (probe === existing) return item
    const short = probe.length <= existing.length ? probe : existing
    const long = probe.length <= existing.length ? existing : probe
    if (short.length >= 8 && long.includes(short) && short.length / long.length >= 0.55) return item
  }
  return null
}

export function taskStackDedupeKey(item: Pick<TaskStackItem, 'title' | 'linkedFailureCategory' | 'linkedPlannerRuleId'>) {
  if (item.linkedFailureCategory) return `failure:${item.linkedFailureCategory}:${item.title.slice(0, 80)}`
  if (item.linkedPlannerRuleId) return `rule:${item.linkedPlannerRuleId}`
  const compact = compactTaskTitle(item.title)
  return `title:${(compact || item.title.trim().toLowerCase()).slice(0, 120)}`
}

export async function upsertTaskStackItem(
  policyDir: string,
  sessionId: string,
  patch: Partial<TaskStackItem> & { title: string }
): Promise<TaskStack> {
  const stack = await loadTaskStack(policyDir, sessionId)
  const normalized = normalizeTaskItem({ ...patch, id: patch.id })
  if (!normalized) return stack
  const key = taskStackDedupeKey(normalized)
  const suppressions = await loadTaskStackSuppressions(policyDir, sessionId)
  const src = normalizeSource(patch.source ?? normalized.source)
  if (src === 'manual' || src === 'user') {
    await clearTaskStackDismissal(policyDir, sessionId, key).catch(() => undefined)
  } else if (isTaskKeyDismissed(suppressions, key)) {
    return stack
  }
  let idx = stack.items.findIndex((t) => taskStackDedupeKey(t) === key || t.id === normalized.id)
  if (idx < 0) {
    const mergeable = findMergeableActiveTask(stack.items, normalized.title)
    if (mergeable) idx = stack.items.findIndex((t) => t.id === mergeable.id)
  }
  const ts = nowIso()
  if (idx >= 0) {
    const prev = stack.items[idx]
    const mergedTitle =
      normalized.title.length > prev.title.length && normalized.title.includes(prev.title.slice(0, 8))
        ? normalized.title
        : prev.title
    stack.items[idx] = {
      ...prev,
      ...normalized,
      id: prev.id,
      title: mergedTitle.slice(0, 240),
      note: String(patch.note ?? normalized.note ?? prev.note).trim().slice(0, 600) || prev.note,
      createdAt: prev.createdAt,
      updatedAt: ts,
      status: patch.status !== undefined ? normalizeStatus(patch.status) : prev.status
    }
  } else {
    stack.items.unshift({ ...normalized, createdAt: ts, updatedAt: ts })
  }
  return saveTaskStack(policyDir, stack)
}

export async function setTaskStackStatus(
  policyDir: string,
  sessionId: string,
  taskId: string,
  status: TaskStatus
): Promise<TaskStack> {
  const stack = await loadTaskStack(policyDir, sessionId)
  const id = String(taskId || '').trim()
  if (!id) return stack
  stack.items = stack.items.map((t) => (t.id === id ? { ...t, status: normalizeStatus(status), updatedAt: nowIso() } : t))
  return saveTaskStack(policyDir, stack)
}

export async function deleteTaskStackItem(policyDir: string, sessionId: string, taskId: string): Promise<TaskStack> {
  const stack = await loadTaskStack(policyDir, sessionId)
  const id = String(taskId || '').trim()
  const removed = stack.items.filter((t) => t.id === id)
  stack.items = stack.items.filter((t) => t.id !== id)
  const dismissKeys = removed.map((t) => taskStackDedupeKey(t))
  if (dismissKeys.length) {
    await dismissTaskStackKeys(policyDir, sessionId, dismissKeys).catch(() => undefined)
    for (const t of removed) {
      await dismissProactiveNudgeKey(policyDir, sessionId, proactiveNudgeLogicalKey({
        reason: 'paused_resume',
        taskId: t.id,
        title: t.title
      })).catch(() => undefined)
      await dismissProactiveNudgeKey(policyDir, sessionId, proactiveNudgeLogicalKey({
        reason: 'overdue',
        taskId: t.id,
        title: t.title
      })).catch(() => undefined)
      await dismissProactiveNudgeKey(policyDir, sessionId, proactiveNudgeLogicalKey({
        reason: 'stale_active',
        taskId: t.id,
        title: t.title
      })).catch(() => undefined)
    }
  }
  return saveTaskStack(policyDir, stack)
}

export async function clearTaskStack(policyDir: string, sessionId: string, onlyDone = false): Promise<TaskStack> {
  const stack = await loadTaskStack(policyDir, sessionId)
  stack.items = onlyDone ? stack.items.filter((t) => t.status !== 'done') : []
  return saveTaskStack(policyDir, stack)
}

export async function migrateTaskStackItems(
  policyDir: string,
  sessionId: string,
  items: unknown[]
): Promise<{ stack: TaskStack; merged: number }> {
  let stack = await loadTaskStack(policyDir, sessionId)
  let merged = 0
  for (const raw of items) {
    const item = normalizeTaskItem(raw)
    if (!item) continue
    const key = taskStackDedupeKey(item)
    if (stack.items.some((t) => taskStackDedupeKey(t) === key || t.id === item.id)) continue
    stack.items.push(item)
    merged += 1
  }
  stack = await saveTaskStack(policyDir, stack)
  return { stack, merged }
}

type SuggestedTask = {
  title: string
  note: string
  priority: TaskPriority
  source: TaskSource
  linkedFailureCategory?: string
  linkedPlannerRuleId?: string
}

export async function suggestTasksFromFailureInsights(policyDir: string): Promise<SuggestedTask[]> {
  const insights = await analyzeFailureInsights(policyDir)
  if (!insights.samples) return []
  const out: SuggestedTask[] = []
  for (const bundle of (insights.fixSuggestions || []).slice(0, 4)) {
    const top = (bundle.suggestions || []).slice(0, 2)
    for (const s of top) {
      out.push({
        title: s.title,
        note: `[${bundle.category}/${bundle.severity}] ${s.action}`,
        priority: s.priority === 'high' ? 'high' : s.priority === 'low' ? 'low' : 'normal',
        source: 'failure',
        linkedFailureCategory: bundle.category
      })
    }
  }
  return out.slice(0, 6)
}

export async function suggestTasksFromPlannerRules(policyDir: string): Promise<SuggestedTask[]> {
  const ruleSet = await loadActivePlannerRules(policyDir)
  if (!ruleSet?.rules?.length) return []
  const out: SuggestedTask[] = []
  for (const rule of ruleSet.rules.slice(0, 4)) {
    if (ruleSet.source !== 'auto' && ruleSet.source !== 'promoted') continue
    out.push({
      title: `验证 Planner 规则：${rule.id}`,
      note: rule.message,
      priority: 'normal',
      source: 'planner_rule',
      linkedPlannerRuleId: rule.id
    })
  }
  return out.slice(0, 3)
}

export async function syncInsightLinkedTasks(policyDir: string, sessionId: string): Promise<{ stack: TaskStack; added: number }> {
  const [failureTasks, ruleTasks, suppressions] = await Promise.all([
    suggestTasksFromFailureInsights(policyDir),
    suggestTasksFromPlannerRules(policyDir),
    loadTaskStackSuppressions(policyDir, sessionId)
  ])
  let stack = await loadTaskStack(policyDir, sessionId)
  let added = 0
  for (const s of [...failureTasks, ...ruleTasks]) {
    const key = taskStackDedupeKey(s)
    if (isTaskKeyDismissed(suppressions, key)) continue
    if (stack.items.some((t) => taskStackDedupeKey(t) === key)) continue
    const item = normalizeTaskItem({
      ...s,
      status: 'paused',
      note: `${s.note}\n（由失败样本/规划规则自动关联，建议人工确认后激活。）`
    })
    if (!item) continue
    stack.items.push(item)
    added += 1
  }
  stack = await saveTaskStack(policyDir, stack)
  return { stack, added }
}

function formatDeadlineLine(deadline?: string) {
  if (!deadline) return ''
  const ms = Date.parse(deadline)
  if (!Number.isFinite(ms)) return ''
  const overdue = ms < Date.now()
  const label = new Date(ms).toLocaleString('zh-CN', { hour12: false })
  return overdue ? `截止 ${label}（已逾期）` : `截止 ${label}`
}

function priorityLabel(p: TaskPriority) {
  return ({ critical: '紧急', high: '高', normal: '普通', low: '低' } as const)[p] || p
}

function statusLabel(s: TaskStatus) {
  return ({ active: '进行中', paused: '已暂停', done: '已完成' } as const)[s] || s
}

export function formatTaskStackBlockForRouter(items: TaskStackItem[]): string {
  const active = sortTaskItems(items).filter((t) => t.status !== 'done').slice(0, 5)
  if (!active.length) return ''
  const lines = active.map((t, i) => {
    const extra = [priorityLabel(t.priority), statusLabel(t.status), formatDeadlineLine(t.deadline)].filter(Boolean).join(' · ')
    const link =
      t.linkedFailureCategory ? ` [失败类别:${t.linkedFailureCategory}]` : t.linkedPlannerRuleId ? ` [规则:${t.linkedPlannerRuleId}]` : ''
    return `${i + 1}. ${t.title}${link}（${extra}）${t.note ? ` — ${t.note.slice(0, 120)}` : ''}`
  })
  return [
    '【会话任务栈（背景参考，非新指令）】',
    '以下为用户在本会话中维护的进行中/暂停目标；仅当用户本轮明确续接该目标时才对齐其数据源与交付物，否则以当前输入为准。',
    ...lines
  ].join('\n')
}

export function formatTaskStackBlockForPlanner(items: TaskStackItem[]): string {
  const active = sortTaskItems(items).filter((t) => t.status === 'active').slice(0, 6)
  if (!active.length) return ''
  const lines = active.map((t, i) => {
    const extra = [priorityLabel(t.priority), formatDeadlineLine(t.deadline)].filter(Boolean).join(' · ')
    return `${i + 1}. ${t.title}（${extra}）${t.note ? `\n   说明：${t.note.slice(0, 180)}` : ''}`
  })
  return [
    '【任务栈 — 规划对齐】',
    '仅当用户本轮明确续接任务栈中的 active 目标时，规划才应对齐；deadline 更早者优先安排前置步骤。',
    ...lines
  ].join('\n')
}

export async function buildTaskStackRecall(
  policyDir: string,
  sessionId?: string
): Promise<{ routerText: string; plannerText: string; items: TaskStackItem[] }> {
  const sid = String(sessionId || '').trim()
  if (!sid) return { routerText: '', plannerText: '', items: [] }
  const stack = await loadTaskStack(policyDir, sid)
  return {
    routerText: formatTaskStackBlockForRouter(stack.items),
    plannerText: formatTaskStackBlockForPlanner(stack.items),
    items: stack.items
  }
}
