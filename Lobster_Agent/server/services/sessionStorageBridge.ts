import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveStorageStatePath } from './sessionStorage'

export type StorageStateLike = {
  cookies?: Array<Record<string, unknown>>
  origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>
}

export async function resolveRunStoragePaths(input: {
  startUrl?: string
  sessionId?: string
  storageProfile?: string
  storageDir?: string
}) {
  return await resolveStorageStatePath(input)
}

export async function readStorageStateFile(loadPath?: string): Promise<StorageStateLike | null> {
  const p = String(loadPath || '').trim()
  if (!p) return null
  try {
    const raw = await fs.readFile(p, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as StorageStateLike) : null
  } catch {
    return null
  }
}

export async function persistCookiesStorage(savePath: string, cookies: Array<Record<string, unknown>>) {
  const p = String(savePath || '').trim()
  if (!p) return
  let existing: StorageStateLike = {}
  try {
    const raw = await fs.readFile(p, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') existing = parsed as StorageStateLike
  } catch {}
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify({ ...existing, cookies }, null, 2), 'utf-8')
}

export function cookiesFromStorageState(state: StorageStateLike | null): Array<Record<string, unknown>> {
  return Array.isArray(state?.cookies) ? state.cookies : []
}

/** Stagehand V3Context.addCookies 接受的 cookie 列表 */
export function stagehandCookiesFromStorage(state: StorageStateLike | null): Array<Record<string, unknown>> {
  const cookies = cookiesFromStorageState(state)
  return cookies
    .map((c) => {
      const name = String(c.name || '').trim()
      const value = String(c.value ?? '').trim()
      if (!name) return null
      const out: Record<string, unknown> = { name, value }
      if (c.domain) out.domain = String(c.domain)
      if (c.path) out.path = String(c.path)
      if (c.url) out.url = String(c.url)
      if (typeof c.secure === 'boolean') out.secure = c.secure
      if (typeof c.httpOnly === 'boolean') out.httpOnly = c.httpOnly
      if (typeof c.sameSite === 'string') out.sameSite = c.sameSite
      if (typeof c.expires === 'number') out.expires = c.expires
      return out
    })
    .filter(Boolean) as Array<Record<string, unknown>>
}
