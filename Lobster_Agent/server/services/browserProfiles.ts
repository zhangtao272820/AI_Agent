/**
 * OpenClaw 类浏览器双 Profile：managed（隔离 userDataDir）| user（CDP 附着已登录 Chrome）
 */
import path from 'node:path'

export type BrowserProfileMode = 'managed' | 'user'

export function resolveBrowserProfile(env: NodeJS.ProcessEnv = process.env): BrowserProfileMode {
  const v = String(env.LOBSTER_BROWSER_PROFILE ?? 'managed').trim().toLowerCase()
  return v === 'user' ? 'user' : 'managed'
}

/** user profile：CDP WebSocket URL（优先 LOBSTER_BROWSER_CDP_URL，兼容 LOBSTER_CDP_URL） */
export function resolveBrowserCdpUrl(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.LOBSTER_BROWSER_CDP_URL ?? env.LOBSTER_CDP_URL ?? '').trim()
}

export function isUserBrowserProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveBrowserProfile(env) === 'user' && Boolean(resolveBrowserCdpUrl(env))
}

/** 合并 runtime / TaskSpec / 环境变量的有效 Profile */
export function resolveRunBrowserProfile(input?: {
  browserProfile?: 'managed' | 'user' | 'auto' | string
  taskSpecProfile?: 'managed' | 'user'
  env?: NodeJS.ProcessEnv
}): BrowserProfileMode {
  const env = input?.env ?? process.env
  const fromTask = input?.taskSpecProfile
  if (fromTask === 'user' || fromTask === 'managed') return fromTask
  const raw = String(input?.browserProfile || '').trim().toLowerCase()
  if (raw === 'user') return 'user'
  if (raw === 'managed') return 'managed'
  return resolveBrowserProfile(env)
}

export function managedBrowserProfileDir(storageProfile?: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = String(env.LOBSTER_BROWSER_PROFILE_DIR ?? '').trim()
  const root = base || path.join(String(env.LOBSTER_STORAGE_DIR ?? '.data/lobster').trim() || '.data/lobster', 'browser-profiles', 'managed')
  const id = String(storageProfile || 'default')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 80) || 'default'
  return path.join(root, id)
}

export function browserProfileLabel(mode: BrowserProfileMode, cdpUrl?: string): string {
  if (mode === 'user') {
    return cdpUrl ? `user-cdp:${cdpUrl.replace(/\/\/[^@]+@/, '//***@').slice(0, 80)}` : 'user-cdp:unset'
  }
  return 'managed'
}
