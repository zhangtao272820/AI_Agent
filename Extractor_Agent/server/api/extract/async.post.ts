import {
  acquireQueueSlot,
  createCrawlJobId,
  enqueueAsyncCrawlJob,
  writeCrawlJob,
  type CrawlJobRecord,
} from '../../services/crawlJobQueue'
import { executeExtractRun } from '../../utils/crawl_run'
import { buildCrawlerAgentResult } from '../../utils/agent_result'
import { ensureInternalAgentAccess } from '../../utils/internal_auth'
import { applyPlatformRuntimeOverrides } from '../../utils/platform_config'
import type { CrawlerAgentOptions } from '../../services/crawlerAgentTypes'
import { getExtractorAgentEnv } from '../../utils/extractor_agent_env'

export default defineEventHandler(async (event) => {
  ensureInternalAgentAccess(event)
  if (!getExtractorAgentEnv().enableAsyncQueue) {
    throw createError({ statusCode: 503, statusMessage: 'async queue disabled' })
  }

  const body = await readBody<{
    task?: string
    question?: string
    options?: CrawlerAgentOptions
    manager_task_json?: string
    managerTask?: Record<string, unknown>
    session_id?: string
    history?: Array<{ role: string; content: string }>
  }>(event)

  const task = String(body?.task ?? body?.question ?? '').trim()
  if (!task) throw createError({ statusCode: 400, statusMessage: 'task 不能为空' })

  const jobId = createCrawlJobId()
  const job: CrawlJobRecord = {
    id: jobId,
    status: 'queued',
    createdAt: new Date().toISOString(),
    task: task.slice(0, 500),
  }
  writeCrawlJob(job)

  const cfg = await applyPlatformRuntimeOverrides(useRuntimeConfig(event) as any)
  const history = Array.isArray(body?.history)
    ? body.history
        .map((m) => ({
          role: (String(m?.role ?? '').toLowerCase() === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: String(m?.content ?? '').trim(),
        }))
        .filter((m) => m.content)
    : undefined

  await enqueueAsyncCrawlJob({
    jobId,
    task,
    options: body?.options ?? {},
    manager_task_json: typeof body?.manager_task_json === 'string' ? body.manager_task_json : undefined,
    managerTask: body?.managerTask,
    session_id: String(body?.session_id ?? '').trim() || undefined,
    history,
    run: async () => {
      const running: CrawlJobRecord = {
        ...job,
        status: 'running',
        startedAt: new Date().toISOString(),
      }
      writeCrawlJob(running)
      try {
        await acquireQueueSlot()
        const started = Date.now()
        const result = await executeExtractRun({
          task,
          options: body?.options ?? {},
          config: cfg,
          signal: AbortSignal.timeout(180_000),
          manager_task_json: typeof body?.manager_task_json === 'string' ? body.manager_task_json : undefined,
          managerTask: body?.managerTask,
          session_id: String(body?.session_id ?? '').trim() || undefined,
          history,
          source: 'async',
        })
        const agentResult = buildCrawlerAgentResult({
          items: Array.isArray(result.items) ? result.items : [],
          outputContent: typeof result.output?.content === 'string' ? result.output.content : '',
          status: result.status,
          meta: (result.meta ?? {}) as Record<string, unknown>,
          stats: (result.stats ?? {}) as Record<string, unknown>,
          planNeedsLogin: Boolean((result.plan as any)?.needsLogin),
        })
        writeCrawlJob({
          ...running,
          status: 'done',
          finishedAt: new Date().toISOString(),
          result: { ...result, agentResult },
          meta: { latency_ms: Date.now() - started },
        })
      } catch (e: any) {
        writeCrawlJob({
          ...running,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: String(e?.message ?? e ?? 'failed'),
        })
      }
    },
  })

  setResponseStatus(event, 202)
  return {
    ok: true,
    job_id: jobId,
    status: 'queued',
    poll: `/api/jobs/${jobId}`,
  }
})
