import { isManagerDockerRuntime } from '../platform/managerEnvModes'

export type AgentJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'error' | 'canceled'

export type AgentJobPollResult<T = unknown> = {
  status: AgentJobStatus
  stage?: string
  pct?: number
  result?: T
  error?: string
  raw?: unknown
}

export type PollAgentJobOptions<T = unknown> = {
  submit: () => Promise<{ jobId: string; pollUrl?: string }>
  poll: (jobId: string) => Promise<AgentJobPollResult<T>>
  intervalMs?: number
  timeoutMs?: number
  signal?: AbortSignal
  onProgress?: (p: AgentJobPollResult<T>) => void
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new Error('aborted'))
      },
      { once: true }
    )
  })
}

function isTerminal(status: AgentJobStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'error' || status === 'canceled'
}

/** 通用 submit → poll 循环；供 GUI / Music / Crawler 异步任务复用 */
export async function pollAgentJob<T = unknown>(opts: PollAgentJobOptions<T>): Promise<T> {
  const intervalMs = Math.max(500, Number(opts.intervalMs ?? 2000))
  const timeoutMs = Math.max(intervalMs * 2, Number(opts.timeoutMs ?? 300_000))
  const deadline = Date.now() + timeoutMs

  const { jobId } = await opts.submit()
  if (!jobId) throw new Error('pollAgentJob: missing jobId')

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error('pollAgentJob aborted')
    const snap = await opts.poll(jobId)
    opts.onProgress?.(snap)
    if (isTerminal(snap.status)) {
      if (snap.status === 'done') return (snap.result ?? snap.raw) as T
      throw new Error(String(snap.error || `job ${snap.status}`))
    }
    await sleep(intervalMs, opts.signal)
  }
  throw new Error(`pollAgentJob timeout after ${timeoutMs}ms`)
}

export function lobsterHttpPollEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.MANAGER_GUI_HTTP_POLL ?? '').trim()
  if (raw === '1') return true
  if (raw === '0') return false
  // Docker extended 栈默认 WS（实时 log/state/screenshot）；HTTP poll 仅作显式 fallback
  return !isManagerDockerRuntime(env)
}

export function musicHttpPollEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_MUSIC_HTTP_POLL ?? '1').trim() !== '0'
}

export function crawlerHttpAsyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_CRAWLER_HTTP_ASYNC ?? '1').trim() !== '0'
}
