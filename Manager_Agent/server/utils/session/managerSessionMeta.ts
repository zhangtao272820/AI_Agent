import fs from 'node:fs/promises'
import path from 'node:path'

export type SessionMeta = {
  title?: string
  customTitle?: boolean
  updatedAt?: string
}

const SESSIONS_DIR = 'sessions'
const META_DIR = 'session-meta'
const TASK_STACK_DIR = 'task-stacks'

function sessionFilePath(dataRoot: string, sessionId: string) {
  return path.join(dataRoot, SESSIONS_DIR, `${sessionId}.json`)
}

function metaFilePath(dataRoot: string, sessionId: string) {
  return path.join(dataRoot, META_DIR, `${sessionId}.json`)
}

function taskStackFilePath(policyDir: string, sessionId: string) {
  return path.join(policyDir, TASK_STACK_DIR, `${sessionId}.json`)
}

export function sanitizeSessionTitle(raw: unknown): string | null {
  const s = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return null
  if (s.length > 80) return s.slice(0, 80)
  return s
}

export async function readSessionMeta(dataRoot: string, sessionId: string): Promise<SessionMeta> {
  const sid = String(sessionId || '').trim()
  if (!sid) return {}
  try {
    const raw = await fs.readFile(metaFilePath(dataRoot, sid), 'utf8')
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return {}
    const title = sanitizeSessionTitle((obj as SessionMeta).title)
    return {
      title: title || undefined,
      customTitle: Boolean((obj as SessionMeta).customTitle),
      updatedAt: String((obj as SessionMeta).updatedAt || '') || undefined
    }
  } catch {
    return {}
  }
}

export async function writeSessionMeta(dataRoot: string, sessionId: string, meta: SessionMeta) {
  const sid = String(sessionId || '').trim()
  if (!sid) return
  const title = sanitizeSessionTitle(meta.title)
  if (!title) {
    await fs.unlink(metaFilePath(dataRoot, sid)).catch(() => undefined)
    return
  }
  await fs.mkdir(path.join(dataRoot, META_DIR), { recursive: true }).catch(() => undefined)
  const payload: SessionMeta = {
    title,
    customTitle: true,
    updatedAt: new Date().toISOString()
  }
  await fs.writeFile(metaFilePath(dataRoot, sid), JSON.stringify(payload, null, 2), 'utf8')
}

export async function deleteSessionArtifacts(params: {
  cwd: string
  policyDir: string
  sessionId: string
}) {
  const sid = String(params.sessionId || '').trim()
  if (!sid) return
  const dataRoot = path.join(params.cwd, '.data')
  await fs.unlink(sessionFilePath(dataRoot, sid)).catch(() => undefined)
  await fs.unlink(metaFilePath(dataRoot, sid)).catch(() => undefined)
  await fs.unlink(taskStackFilePath(params.policyDir, sid)).catch(() => undefined)
}
