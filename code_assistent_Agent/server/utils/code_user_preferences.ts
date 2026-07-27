/**
 * P4 轻量用户偏好：沉淀常关注文件与任务类型，注入 compute/agent。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCodeAgentEnv } from './code_agent_env'
import type { CodeTaskKind } from './code_learning'

export type CodeUserPreferences = {
  updated_at: string
  query_count?: number
  preferred_mode?: string
  frequent_files?: string[]
  frequent_task_kinds?: string[]
}

const GLOBAL_KEY = '__global__'

function prefsFile() {
  const dir = join(process.cwd(), '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'code-user-preferences.json')
}

function loadAll(): Record<string, CodeUserPreferences> {
  const p = prefsFile()
  if (!existsSync(p)) return {}
  try {
    const o = JSON.parse(readFileSync(p, 'utf8')) as Record<string, CodeUserPreferences>
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

function saveAll(store: Record<string, CodeUserPreferences>) {
  writeFileSync(prefsFile(), JSON.stringify(store, null, 2), 'utf8')
}

export function normalizeUserKey(key?: string) {
  const k = String(key ?? '').trim().slice(0, 64)
  return k || GLOBAL_KEY
}

export function getUserPreferences(sessionKey?: string): CodeUserPreferences {
  const store = loadAll()
  return store[normalizeUserKey(sessionKey)] ?? { updated_at: '', query_count: 0 }
}

export function learnFromSuccessfulCodeQuery(input: {
  sessionKey?: string
  question: string
  task_kind?: CodeTaskKind
  hint_files?: string[]
  mode?: string
}) {
  if (!getCodeAgentEnv().enableLearningLoop) return
  const key = normalizeUserKey(input.sessionKey)
  const store = loadAll()
  const prev = store[key] ?? { updated_at: '', query_count: 0 }
  const files = [...(prev.frequent_files ?? [])]
  for (const f of input.hint_files ?? []) {
    const p = String(f ?? '').trim()
    if (!p) continue
    if (!files.includes(p)) files.unshift(p)
  }
  const kinds = [...(prev.frequent_task_kinds ?? [])]
  const tk = String(input.task_kind ?? '').trim()
  if (tk && !kinds.includes(tk)) kinds.unshift(tk)
  store[key] = {
    updated_at: new Date().toISOString(),
    query_count: (prev.query_count ?? 0) + 1,
    preferred_mode: input.mode || prev.preferred_mode,
    frequent_files: files.slice(0, 12),
    frequent_task_kinds: kinds.slice(0, 6),
  }
  saveAll(store)
}

export function formatUserPreferencesBlock(sessionKey?: string): string {
  const prefs = getUserPreferences(sessionKey)
  const lines: string[] = []
  if (prefs.preferred_mode && prefs.preferred_mode !== 'auto') {
    lines.push(`- 常用模式：${prefs.preferred_mode}`)
  }
  if (prefs.frequent_files?.length) {
    lines.push(`- 常关注文件：${prefs.frequent_files.slice(0, 4).join('、')}`)
  }
  if (prefs.frequent_task_kinds?.length) {
    lines.push(`- 常走路径：${prefs.frequent_task_kinds.slice(0, 3).join('、')}`)
  }
  if (!lines.length) return ''
  return `[用户偏好]\n${lines.join('\n')}`
}

export function clearUserPreferences() {
  try {
    writeFileSync(prefsFile(), JSON.stringify({ [GLOBAL_KEY]: { updated_at: new Date().toISOString() } }, null, 2), 'utf8')
  } catch {
    /* ignore */
  }
}
