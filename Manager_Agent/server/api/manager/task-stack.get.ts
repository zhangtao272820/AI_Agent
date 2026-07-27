import path from 'node:path'
import { z } from 'zod'
import { loadTaskStack, syncInsightLinkedTasks } from '../../graph/core/task/taskStack'

const SessionIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/)

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const sessionId = SessionIdSchema.parse(String(query.sessionId || ''))
  const sync = String(query.sync || '').trim() === '1'
  const policyDir = path.join(process.cwd(), '.data')

  let stack = await loadTaskStack(policyDir, sessionId)
  let insightAdded = 0
  if (sync) {
    const r = await syncInsightLinkedTasks(policyDir, sessionId).catch(() => ({ stack, added: 0 }))
    stack = r.stack
    insightAdded = r.added
  }

  return {
    ok: true,
    sessionId,
    stack,
    insightAdded
  }
})
