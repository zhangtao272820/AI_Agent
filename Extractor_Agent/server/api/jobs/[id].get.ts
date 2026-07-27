import { readCrawlJob, getQueueStatsAsync } from '../../services/crawlJobQueue'
import { ensureInternalAgentAccess } from '../../utils/internal_auth'

export default defineEventHandler(async (event) => {
  ensureInternalAgentAccess(event)
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw createError({ statusCode: 400, statusMessage: 'job id required' })

  const job = readCrawlJob(id)
  if (!job) throw createError({ statusCode: 404, statusMessage: 'job not found' })

  return {
    ok: true,
    job,
    queue: await getQueueStatsAsync(),
  }
})
