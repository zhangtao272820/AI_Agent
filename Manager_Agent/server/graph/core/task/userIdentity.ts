import path from 'node:path'
import {
  bindSessionUser,
  listKnownUserIds as listKnownUserIdsPg,
  listSessionIdsForUser,
  migrateUserSessionMapFromFile,
  removeSessionUserMapping,
  resolveSessionUserId,
  sanitizeUserId
} from '#agent-shared/userSessionMapStore'

export { sanitizeUserId }

let migrated = false

async function ensureMigrated(policyDir: string) {
  if (migrated) return
  migrated = true
  await migrateUserSessionMapFromFile(policyDir).catch(() => undefined)
}

export async function bindSessionToUser(policyDir: string, sessionId: string, userId: string) {
  await ensureMigrated(policyDir)
  return bindSessionUser(sessionId, userId, policyDir)
}

export async function resolveUserId(
  policyDir: string,
  sessionId?: string,
  explicitUserId?: string
): Promise<string | null> {
  await ensureMigrated(policyDir)
  const sid = String(sessionId || '').trim()
  const explicit = sanitizeUserId(explicitUserId)
  if (explicit) {
    if (sid) await bindSessionUser(sessionId, explicit, policyDir)
    return explicit
  }
  if (!sid) return null
  const mapped = await resolveSessionUserId(sid, policyDir)
  if (mapped) return mapped
  return sid
}

export async function listSessionsForUser(policyDir: string, userId: string): Promise<string[]> {
  await ensureMigrated(policyDir)
  return listSessionIdsForUser(userId, policyDir)
}

export async function listKnownUserIds(policyDir: string): Promise<string[]> {
  await ensureMigrated(policyDir)
  return listKnownUserIdsPg(policyDir)
}

export async function removeSessionFromUserMap(policyDir: string, sessionId: string) {
  await removeSessionUserMapping(sessionId, policyDir)
}

/** @deprecated 仅兼容旧引用 */
export function userIdentityPolicyDir(cwd = process.cwd()) {
  return path.join(cwd, '.data')
}
