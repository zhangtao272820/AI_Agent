import fs from 'node:fs/promises'
import path from 'node:path'

export type TaskStackSuppressions = {
  sessionId: string
  updatedAt: string
  /** taskStack dedupe keys（删除/忽略后不再自动 sync 回来） */
  dismissedTaskKeys: string[]
  /** proactive nudge 逻辑键 reason|taskId|title */
  dismissedNudgeKeys: string[]
}

const SUPPRESS_DIR = 'task-stack-suppressions'

function nowIso() {
  return new Date().toISOString()
}

function filePath(policyDir: string, sessionId: string) {
  return path.join(policyDir, SUPPRESS_DIR, `${String(sessionId || '').trim()}.json`)
}

export async function loadTaskStackSuppressions(
  policyDir: string,
  sessionId: string
): Promise<TaskStackSuppressions> {
  const sid = String(sessionId || '').trim()
  if (!sid) return { sessionId: '', updatedAt: nowIso(), dismissedTaskKeys: [], dismissedNudgeKeys: [] }
  try {
    const raw = await fs.readFile(filePath(policyDir, sid), 'utf8')
    const o = JSON.parse(raw) as TaskStackSuppressions
    return {
      sessionId: sid,
      updatedAt: String(o?.updatedAt || nowIso()),
      dismissedTaskKeys: Array.isArray(o?.dismissedTaskKeys)
        ? [...new Set(o.dismissedTaskKeys.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 200)
        : [],
      dismissedNudgeKeys: Array.isArray(o?.dismissedNudgeKeys)
        ? [...new Set(o.dismissedNudgeKeys.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 200)
        : []
    }
  } catch {
    return { sessionId: sid, updatedAt: nowIso(), dismissedTaskKeys: [], dismissedNudgeKeys: [] }
  }
}

async function saveSuppressions(policyDir: string, doc: TaskStackSuppressions) {
  const sid = String(doc.sessionId || '').trim()
  if (!sid) return doc
  const next: TaskStackSuppressions = {
    sessionId: sid,
    updatedAt: nowIso(),
    dismissedTaskKeys: [...new Set(doc.dismissedTaskKeys)].slice(0, 200),
    dismissedNudgeKeys: [...new Set(doc.dismissedNudgeKeys)].slice(0, 200)
  }
  const dir = path.join(policyDir, SUPPRESS_DIR)
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
  await fs.writeFile(filePath(policyDir, sid), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export async function dismissTaskStackKeys(
  policyDir: string,
  sessionId: string,
  keys: string[]
): Promise<TaskStackSuppressions> {
  const doc = await loadTaskStackSuppressions(policyDir, sessionId)
  for (const k of keys) {
    const key = String(k || '').trim()
    if (key) doc.dismissedTaskKeys.push(key)
  }
  return saveSuppressions(policyDir, doc)
}

export async function dismissProactiveNudgeKey(
  policyDir: string,
  sessionId: string,
  nudgeKey: string
): Promise<TaskStackSuppressions> {
  const doc = await loadTaskStackSuppressions(policyDir, sessionId)
  const key = String(nudgeKey || '').trim()
  if (key) doc.dismissedNudgeKeys.push(key)
  return saveSuppressions(policyDir, doc)
}

export function isTaskKeyDismissed(suppressions: TaskStackSuppressions, key: string) {
  return suppressions.dismissedTaskKeys.includes(String(key || '').trim())
}

export function isNudgeKeyDismissed(suppressions: TaskStackSuppressions, nudgeKey: string) {
  return suppressions.dismissedNudgeKeys.includes(String(nudgeKey || '').trim())
}

export function proactiveNudgeLogicalKey(n: { reason?: string; taskId?: string; title?: string }) {
  return `${String(n.reason || '')}|${String(n.taskId || n.title || '')}`
}

export async function clearTaskStackDismissal(
  policyDir: string,
  sessionId: string,
  taskKey: string
): Promise<TaskStackSuppressions> {
  const doc = await loadTaskStackSuppressions(policyDir, sessionId)
  const key = String(taskKey || '').trim()
  doc.dismissedTaskKeys = doc.dismissedTaskKeys.filter((k) => k !== key)
  return saveSuppressions(policyDir, doc)
}
