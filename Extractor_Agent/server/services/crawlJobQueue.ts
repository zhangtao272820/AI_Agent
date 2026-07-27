/**
 * 采集任务队列：进程内并发闸门 + 可选异步 job 持久化（无需 Redis 即可控并发）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getExtractorAgentEnv } from '../utils/extractor_agent_env'
import { enqueueCrawlJobRedis, getRedisQueueStats, isRedisQueueReady } from '../core/queue/redisBackend'

export type CrawlJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export type CrawlJobRecord = {
  id: string
  status: CrawlJobStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  task: string
  error?: string
  result?: unknown
  meta?: Record<string, unknown>
}

type QueueTask = () => Promise<void>

let active = 0
const waiters: Array<() => void> = []
const pending: QueueTask[] = []

function jobsDir() {
  const dir = join(process.cwd(), '.data', 'crawl-jobs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function jobFile(id: string) {
  return join(jobsDir(), `${id}.json`)
}

export function writeCrawlJob(job: CrawlJobRecord) {
  try {
    writeFileSync(jobFile(job.id), JSON.stringify(job, null, 2), 'utf8')
  } catch {
    /* ignore */
  }
}

export function readCrawlJob(id: string): CrawlJobRecord | null {
  try {
    const raw = readFileSync(jobFile(id), 'utf8')
    return JSON.parse(raw) as CrawlJobRecord
  } catch {
    return null
  }
}

function pumpQueue() {
  const max = getExtractorAgentEnv().queueMaxConcurrent
  while (active < max && pending.length > 0) {
    const task = pending.shift()
    if (!task) break
    active += 1
    void task().finally(() => {
      active -= 1
      pumpQueue()
      const next = waiters.shift()
      if (next) next()
    })
  }
}

export function acquireQueueSlot(): Promise<void> {
  const max = getExtractorAgentEnv().queueMaxConcurrent
  if (active < max) return Promise.resolve()
  return new Promise((resolve) => {
    waiters.push(resolve)
    pumpQueue()
  })
}

export function enqueueCrawlJob(run: QueueTask) {
  pending.push(run)
  pumpQueue()
}

export function createCrawlJobId() {
  return `crawl_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export function getQueueStats() {
  const local = {
    active,
    pending: pending.length,
    maxConcurrent: getExtractorAgentEnv().queueMaxConcurrent,
    backend: 'local' as const,
  }
  if (getExtractorAgentEnv().queueBackend === 'redis' && isRedisQueueReady()) {
    return local
  }
  return local
}

export async function getQueueStatsAsync() {
  const env = getExtractorAgentEnv()
  if (env.queueBackend === 'redis') {
    const redis = await getRedisQueueStats().catch(() => null)
    if (redis) return redis
  }
  return getQueueStats()
}

/** 异步 job 入队：redis 后端跨实例，local 后端进程内 */
export async function enqueueAsyncCrawlJob(payload: {
  jobId: string
  task: string
  options?: Record<string, unknown>
  manager_task_json?: string
  managerTask?: Record<string, unknown>
  session_id?: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  run: QueueTask
}) {
  const env = getExtractorAgentEnv()
  if (env.queueBackend === 'redis' && env.redisUrl) {
    await enqueueCrawlJobRedis({
      jobId: payload.jobId,
      task: payload.task,
      options: payload.options,
      manager_task_json: payload.manager_task_json,
      managerTask: payload.managerTask,
      session_id: payload.session_id,
      history: payload.history,
    })
    return
  }
  enqueueCrawlJob(payload.run)
}
