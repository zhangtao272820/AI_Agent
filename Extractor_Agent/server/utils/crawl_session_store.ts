/**
 * 按 host 持久化浏览器 cookie 会话（Playwright cookies 格式）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type StoredSession = {
  host: string
  updatedAt: string
  cookies: Array<Record<string, unknown>>
}

function sessionDir() {
  const dir = join(process.cwd(), '.data', 'extractor-sessions')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function safeHostKey(host: string) {
  return String(host ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '_')
    .slice(0, 120)
}

function sessionFile(host: string) {
  const key = safeHostKey(host)
  if (!key) return ''
  return join(sessionDir(), `${key}.json`)
}

export function loadSessionForHost(host: string): StoredSession | null {
  const file = sessionFile(host)
  if (!file || !existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as StoredSession
    if (!parsed || !Array.isArray(parsed.cookies)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveSessionForHost(host: string, cookies: Array<Record<string, unknown>>) {
  const h = String(host ?? '').trim()
  if (!h || !Array.isArray(cookies) || cookies.length === 0) return
  const file = sessionFile(h)
  if (!file) return
  const row: StoredSession = {
    host: h,
    updatedAt: new Date().toISOString(),
    cookies: cookies.slice(0, 80),
  }
  try {
    writeFileSync(file, JSON.stringify(row, null, 2), 'utf8')
  } catch {
    /* ignore */
  }
}

export function listStoredSessionHosts(): string[] {
  const dir = sessionDir()
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/i, ''))
      .slice(0, 40)
  } catch {
    return []
  }
}
