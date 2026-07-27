import path from 'node:path'
import { z } from 'zod'
import { buildLayeredMemoryDashboard } from '../../graph/core/layeredMemory'

const SessionIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/)
  .optional()

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const sessionId = query.sessionId ? SessionIdSchema.parse(String(query.sessionId)) : undefined
  const policyDir = path.join(process.cwd(), '.data')
  const dashboard = await buildLayeredMemoryDashboard(policyDir, sessionId)
  return { ok: true, dashboard }
})
