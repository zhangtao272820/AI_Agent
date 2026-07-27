import path from 'node:path'
import { bindSessionToUser, listSessionsForUser, resolveUserId } from '../../graph/core/task/userIdentity'
import { readSessionMeta } from '../../utils/session/managerSessionMeta'
import { readManagerSession } from '../../utils/session/managerSessionStore'
import { agentPgQuery } from '#agent-shared/agentPgClient'
import { isPostgresStorageEnabled, resolveStorageBackend } from '#agent-shared/storageBackend'

function stripAttachmentSuffix(content: string) {
  return String(content || '')
    .replace(/\n\[附件:[^\]]+\]\s*$/i, '')
    .replace(/^\[附件:[^\]]+\]\s*$/i, '')
    .trim()
}

function previewTitle(messages: Array<{ role?: string; content?: string }>) {
  const firstUser = messages.find((m) => String(m?.role || '').toLowerCase() === 'user')
  const raw = stripAttachmentSuffix(String(firstUser?.content || ''))
  if (!raw) return '新会话'
  return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw
}

async function sessionUpdatedAt(sessionId: string): Promise<string | undefined> {
  if (!isPostgresStorageEnabled(resolveStorageBackend(process.env.MANAGER_STORAGE_BACKEND, 'file'))) {
    return undefined
  }
  const res = await agentPgQuery<{ updated_at: Date | string }>(
    `SELECT updated_at FROM mgr_sessions WHERE id = $1`,
    [sessionId]
  )
  const ts = res?.rows?.[0]?.updated_at
  if (!ts) return undefined
  return ts instanceof Date ? ts.toISOString() : String(ts)
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const policyDir = path.join(process.cwd(), '.data')
  const dataRoot = path.join(process.cwd(), '.data')
  const anchorSessionId = query.sessionId ? String(query.sessionId) : undefined
  const explicitUserId = query.userId ? String(query.userId) : undefined
  const userId = await resolveUserId(policyDir, anchorSessionId, explicitUserId)
  if (!userId) return { items: [] as Array<Record<string, unknown>> }

  const historyIdsRaw = query.historyIds ? String(query.historyIds) : ''
  const historyIds = historyIdsRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]+$/.test(s))
    .slice(0, 80)

  const sessionIdSet = new Set(await listSessionsForUser(policyDir, userId))
  if (anchorSessionId) sessionIdSet.add(anchorSessionId)
  for (const id of historyIds) sessionIdSet.add(id)
  for (const id of sessionIdSet) {
    await bindSessionToUser(policyDir, id, userId).catch(() => undefined)
  }

  const items: Array<{
    id: string
    title: string
    updatedAt: string
    messageCount: number
    userMessageCount: number
    customTitle?: boolean
  }> = []

  for (const sid of sessionIdSet) {
    const id = String(sid || '').trim()
    if (!id) continue
    const session = await readManagerSession(id)
    const messages = session.messages || []
    const meta = await readSessionMeta(dataRoot, id)
    const pgUpdated = await sessionUpdatedAt(id)
    const userMessageCount = messages.filter((m) => m.role === 'user').length
    const autoTitle = previewTitle(messages)

    if (!messages.length && !(meta.customTitle && meta.title)) {
      continue
    }

    items.push({
      id,
      title: meta.customTitle && meta.title ? meta.title : autoTitle,
      updatedAt: meta.updatedAt || pgUpdated || new Date().toISOString(),
      messageCount: messages.length,
      userMessageCount,
      customTitle: Boolean(meta.customTitle && meta.title)
    })
  }

  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return { items }
})
