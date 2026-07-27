import { executeExtractRun } from '../utils/crawl_run'
import { getRunMeta } from '../utils/crawl_metrics'
import { buildCrawlerAgentResult } from '../utils/agent_result'
import { appendAgentTraceLog } from '../utils/trace_log'
import { ensureInternalAgentAccess } from '../utils/internal_auth'
import { applyPlatformRuntimeOverrides } from '../utils/platform_config'
import { getExtractorAgentEnv } from '../utils/extractor_agent_env'
import { enqueueCrawlJob } from '../services/crawlJobQueue'
import type { CrawlerAgentOptions } from '../services/crawlerAgentTypes'

export default defineEventHandler(async (event) => {
  ensureInternalAgentAccess(event)
  const body = await readBody<{
    task?: string
    question?: string
    options?: CrawlerAgentOptions
    manager_task_json?: string
    managerTask?: Record<string, unknown>
    session_id?: string
    sessionId?: string
    network?: boolean
    history?: Array<{ role: string; content: string }>
  }>(event)

  const task = String(body?.task ?? body?.question ?? '').trim()
  if (!task) {
    throw createError({ statusCode: 400, statusMessage: 'task 不能为空' })
  }

  const cfg = await applyPlatformRuntimeOverrides(useRuntimeConfig(event) as any)
  const ctrl = new AbortController()
  event.node.req.on('close', () => ctrl.abort())

  const history = Array.isArray(body?.history)
    ? body!.history!
        .map((m) => ({
          role: (String(m?.role ?? '').toLowerCase() === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: String(m?.content ?? '').trim(),
        }))
        .filter((m) => m.content)
    : undefined

  const traceId =
    String(event.node.req.headers['x-trace-id'] ?? event.node.req.headers['x-run-id'] ?? '').trim() || undefined
  const started = Date.now()

  const runParams = {
    task,
    options: body?.options ?? {},
    config: cfg,
    signal: ctrl.signal,
    manager_task_json: typeof body?.manager_task_json === 'string' ? body.manager_task_json : undefined,
    managerTask: body?.managerTask,
    session_id: String(body?.session_id ?? body?.sessionId ?? '').trim() || undefined,
    history,
    network: typeof body?.network === 'boolean' ? body.network : undefined,
    source: 'http' as const,
  }

  const result = getExtractorAgentEnv().enableAsyncQueue
    ? await new Promise<Awaited<ReturnType<typeof executeExtractRun>>>((resolve, reject) => {
        enqueueCrawlJob(async () => {
          try {
            resolve(await executeExtractRun(runParams))
          } catch (e) {
            reject(e)
          }
        })
      })
    : await executeExtractRun(runParams)

  const agentResult = buildCrawlerAgentResult({
    items: Array.isArray(result.items) ? result.items : [],
    outputContent:
      typeof result.output?.content === 'string'
        ? result.output.content
        : JSON.stringify(result.output?.content ?? ''),
    status: result.status,
    trace_id: traceId,
    latency_ms: Date.now() - started,
    serp_fallback: Boolean((result.meta as any)?.serp_fallback),
    clarifyReason: String((result as any)?.clarify?.reason ?? ''),
    stats: (result.stats && typeof result.stats === 'object' ? result.stats : {}) as Record<string, unknown>,
    taskPlan: {
      needsLogin: Boolean((result.taskPlan as any)?.needsLogin),
      preferredChannel: String((result.taskPlan as any)?.preferredChannel ?? ''),
    },
    lastError: String((result.stats as any)?.lastError ?? ''),
    meta: (result.meta && typeof result.meta === 'object' ? result.meta : {}) as Record<string, unknown>,
    failureTags: Array.isArray((result.meta as any)?.failure_tags) ? (result.meta as any).failure_tags : undefined,
    planNeedsLogin: Boolean((result.plan as any)?.needsLogin),
  })

  void appendAgentTraceLog({
    agent: 'crawler',
    path: '/api/extract',
    trace_id: traceId,
    ok: agentResult.ok,
    latency_ms: Date.now() - started,
    detail: String(result.status || ''),
  })

  return {
    ok: true,
    ...result,
    meta: result.meta ?? getRunMeta(),
    agentResult,
  }
})
