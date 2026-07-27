/**
 * P4-2b：BullMQ 分布式采集队列（多 Extractor 实例共享 async job）。
 * 仅用于 /api/extract/async 等可序列化载荷；同步 WS 仍走进程内 local 闸门。
 */
import type { CrawlJobRecord } from '../../services/crawlJobQueue'

export type CrawlJobPayload = {
  jobId: string
  task: string
  options?: Record<string, unknown>
  manager_task_json?: string
  managerTask?: Record<string, unknown>
  session_id?: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  configSnapshot?: Record<string, unknown>
}

export type CrawlJobProcessor = (payload: CrawlJobPayload) => Promise<{
  result?: unknown
  error?: string
  meta?: Record<string, unknown>
}>

const QUEUE_NAME = 'extractor-crawl-v1'

let queue: import('bullmq').Queue | null = null
let worker: import('bullmq').Worker | null = null
let connection: import('ioredis').default | null = null

export function isRedisQueueReady() {
  return Boolean(queue && worker)
}

export async function initCrawlRedisQueue(redisUrl: string, concurrency: number, processor: CrawlJobProcessor) {
  if (worker) return
  const [{ Queue, Worker }, IORedis] = await Promise.all([import('bullmq'), import('ioredis')])
  connection = new IORedis.default(redisUrl, { maxRetriesPerRequest: null })
  queue = new Queue(QUEUE_NAME, { connection })
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const payload = job.data as CrawlJobPayload
      return processor(payload)
    },
    { connection, concurrency: Math.max(1, concurrency) },
  )
  worker.on('failed', (job, err) => {
    console.warn('[extractor-queue] job failed', job?.id, err?.message)
  })
}

export async function enqueueCrawlJobRedis(payload: CrawlJobPayload) {
  if (!queue) throw new Error('redis queue not initialized')
  await queue.add(payload.jobId, payload, {
    jobId: payload.jobId,
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 86400, count: 200 },
  })
}

export async function getRedisQueueStats() {
  if (!queue) return null
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ])
  return { waiting, active, completed, failed, backend: 'redis' as const }
}

export async function shutdownCrawlRedisQueue() {
  try {
    await worker?.close()
  } catch {}
  try {
    await queue?.close()
  } catch {}
  try {
    await connection?.quit()
  } catch {}
  worker = null
  queue = null
  connection = null
}

export async function readRedisJobRecord(jobId: string): Promise<Partial<CrawlJobRecord> | null> {
  if (!queue) return null
  const job = await queue.getJob(jobId)
  if (!job) return null
  const state = await job.getState()
  const finished = job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined
  const started = job.processedOn ? new Date(job.processedOn).toISOString() : undefined
  const returnvalue = job.returnvalue as { result?: unknown; error?: string; meta?: Record<string, unknown> } | undefined
  const status =
    state === 'completed' ? 'done' : state === 'failed' ? 'failed' : state === 'active' ? 'running' : 'queued'
  return {
    id: jobId,
    status,
    startedAt: started,
    finishedAt: finished,
    result: returnvalue?.result,
    error: returnvalue?.error || (job.failedReason ? String(job.failedReason) : undefined),
    meta: returnvalue?.meta,
  }
}
