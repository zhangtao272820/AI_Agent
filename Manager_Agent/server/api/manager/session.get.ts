import { z } from 'zod'
import { readManagerSession } from '../../utils/session/managerSessionStore'

const QuerySchema = z.object({
  sessionId: z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/)
})

export default defineEventHandler(async (event) => {
  const query = QuerySchema.parse(getQuery(event))
  const session = await readManagerSession(query.sessionId)
  return {
    sessionId: query.sessionId,
    messages: session.messages || []
  }
})
