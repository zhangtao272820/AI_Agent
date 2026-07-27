/**
 * Nitro 启动时初始化 Redis 采集 Worker（EXTRACTOR_QUEUE_BACKEND=redis）。
 */
import { getExtractorAgentEnv } from '../utils/extractor_agent_env'
import { applyPlatformRuntimeOverrides } from '../utils/platform_config'
import { executeExtractRun } from '../utils/crawl_run'
import { buildCrawlerAgentResult } from '../utils/agent_result'
import { writeCrawlJob, type CrawlJobRecord } from '../services/crawlJobQueue'
import { initCrawlRedisQueue, type CrawlJobPayload } from '../core/queue/redisBackend'

export default defineNitroPlugin(async () => {
  const env = getExtractorAgentEnv()
  if (env.queueBackend !== 'redis' || !env.redisUrl) return

  await initCrawlRedisQueue(env.redisUrl, env.queueMaxConcurrent, async (payload: CrawlJobPayload) => {
    const running: CrawlJobRecord = {
      id: payload.jobId,
      status: 'running',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      task: payload.task.slice(0, 500),
    }
    writeCrawlJob(running)
    try {
      const cfg = await applyPlatformRuntimeOverrides(useRuntimeConfig() as any)
      const mergedCfg = payload.configSnapshot ? { ...cfg, ...payload.configSnapshot } : cfg
      const result = await executeExtractRun({
        task: payload.task,
        options: (payload.options ?? {}) as any,
        config: mergedCfg as any,
        signal: AbortSignal.timeout(180_000),
        manager_task_json: payload.manager_task_json,
        managerTask: payload.managerTask,
        session_id: payload.session_id,
        history: payload.history,
        source: 'async-redis',
      })
      const agentResult = buildCrawlerAgentResult({
        items: Array.isArray(result.items) ? result.items : [],
        outputContent: typeof result.output?.content === 'string' ? result.output.content : '',
        status: result.status,
        meta: (result.meta ?? {}) as Record<string, unknown>,
        stats: (result.stats ?? {}) as Record<string, unknown>,
        planNeedsLogin: Boolean((result.plan as any)?.needsLogin),
      })
      const done: CrawlJobRecord = {
        ...running,
        status: 'done',
        finishedAt: new Date().toISOString(),
        result: { ...result, agentResult },
        meta: (result.meta ?? {}) as Record<string, unknown>,
      }
      writeCrawlJob(done)
      return { result: done.result, meta: done.meta }
    } catch (e: any) {
      const failed: CrawlJobRecord = {
        ...running,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: String(e?.message || e),
      }
      writeCrawlJob(failed)
      return { error: failed.error }
    }
  })

  console.log(`[extractor] Redis crawl queue worker started (${env.redisUrl})`)
})
