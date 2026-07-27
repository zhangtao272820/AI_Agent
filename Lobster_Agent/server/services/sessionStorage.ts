import fs from 'node:fs/promises'
import path from 'node:path'

export function lobsterSessionDir(): string {
  return String(process.env.LOBSTER_SESSION_DIR ?? path.resolve(process.cwd(), '.data', 'sessions')).trim()
}

function safeSegment(s: string): string {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80)
}

export async function resolveStorageStatePath(input: {
  startUrl?: string
  sessionId?: string
  storageProfile?: string
  storageDir?: string
}): Promise<{ savePath?: string; loadPath?: string }> {
  const baseDir = String(input.storageDir || lobsterSessionDir()).trim()
  if (!baseDir) return {}

  const profile = String(input.storageProfile || '').trim()
  const sessionId = String(input.sessionId || '').trim()

  let host = ''
  const url = String(input.startUrl || '').trim()
  if (url) {
    try {
      host = new URL(url).hostname
    } catch {}
  }

  if (profile) {
    const p = path.resolve(baseDir, `${safeSegment(profile)}.storage.json`)
    await fs.mkdir(path.dirname(p), { recursive: true })
    let loadPath: string | undefined
    try {
      await fs.access(p)
      loadPath = p
    } catch {}
    return { savePath: p, loadPath }
  }

  if (sessionId && host) {
    const p = path.resolve(baseDir, safeSegment(sessionId), `${safeSegment(host)}.storage.json`)
    await fs.mkdir(path.dirname(p), { recursive: true })
    let loadPath: string | undefined
    try {
      await fs.access(p)
      loadPath = p
    } catch {}
    return { savePath: p, loadPath }
  }

  if (host) {
    const p = path.resolve(baseDir, '_by_host', `${safeSegment(host)}.storage.json`)
    await fs.mkdir(path.dirname(p), { recursive: true })
    let loadPath: string | undefined
    try {
      await fs.access(p)
      loadPath = p
    } catch {}
    return { savePath: p, loadPath }
  }

  return {}
}

export async function importStorageStateJson(profile: string, json: unknown, storageDir?: string): Promise<string> {
  const baseDir = String(storageDir || lobsterSessionDir()).trim()
  const p = path.resolve(baseDir, `${safeSegment(profile)}.storage.json`)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(json, null, 2), 'utf-8')
  return p
}
