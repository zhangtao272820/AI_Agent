/**
 * 统一 user_key 解析：user_id > sessionId > conversationId > __global__
 * 见 docs/Agent记忆与存储数据库化升级方案.md §2.3 / §3.1
 */

export type UserKeyInput = {
  userId?: string | null
  sessionId?: string | null
  conversationId?: string | null
}

export function resolveUserKey(input: UserKeyInput): string {
  const uid = String(input.userId ?? '').trim()
  if (uid) return uid
  const sid = String(input.sessionId ?? '').trim()
  if (sid) return sid
  const cid = String(input.conversationId ?? '').trim()
  if (cid) return cid
  return '__global__'
}
