import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { resolveAgentDatabaseUrl } from '#agent-shared/storageBackend'

export type CheckpointerMode = 'off' | 'memory' | 'postgres'

let memorySaver: MemorySaver | null = null
let postgresSaver: unknown | null = null
let postgresReady = false
let postgresInitPromise: Promise<void> | null = null

export function resolveManagerCheckpointerMode(env: NodeJS.ProcessEnv = process.env): CheckpointerMode {
  const raw = String(env.MANAGER_LANGGRAPH_CHECKPOINTER ?? '').trim().toLowerCase()
  if (raw === 'postgres' || raw === 'pg') return 'postgres'
  if (raw === '1' || raw === 'true' || raw === 'memory') return 'memory'
  if (raw === '0' || raw === 'false' || raw === 'off') return 'off'
  const url = resolveAgentDatabaseUrl(env)
  if (url && String(env.MGR_CHECKPOINTER_AUTO ?? '1').trim() !== '0') return 'postgres'
  return 'off'
}

export function isManagerLangGraphCheckpointerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveManagerCheckpointerMode(env) !== 'off'
}

export async function initManagerPostgresCheckpointer(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (resolveManagerCheckpointerMode(env) !== 'postgres') return false
  if (postgresReady && postgresSaver) return true
  if (!postgresInitPromise) {
    postgresInitPromise = (async () => {
      const url = resolveAgentDatabaseUrl(env)
      if (!url) return
      try {
        const mod = await import('@langchain/langgraph-checkpoint-postgres')
        const PostgresSaver = (mod as { PostgresSaver: { fromConnString: (u: string) => { setup: () => Promise<void> } } })
          .PostgresSaver
        const saver = PostgresSaver.fromConnString(url.replace(/^postgresql\+psycopg2:/, 'postgresql:'))
        await saver.setup()
        postgresSaver = saver
        postgresReady = true
      } catch {
        postgresSaver = null
        postgresReady = false
      }
    })()
  }
  await postgresInitPromise
  return Boolean(postgresSaver)
}

export function getManagerLangGraphCheckpointer(): MemorySaver | unknown | undefined {
  const mode = resolveManagerCheckpointerMode()
  if (mode === 'off') return undefined
  if (mode === 'postgres') {
    return postgresSaver ?? undefined
  }
  if (!memorySaver) memorySaver = new MemorySaver()
  return memorySaver
}

export function resetManagerLangGraphCheckpointerForTests(): void {
  memorySaver = null
  postgresSaver = null
  postgresReady = false
  postgresInitPromise = null
}

/** 图 invoke：每轮 run 独立 thread；无 runId 时才回退 sess-*（HITL 续跑等） */
export function resolveLangGraphThreadId(input: {
  runId?: string
  sessionId?: string
  threadId?: string
  /** @deprecated 每轮 run 已默认隔离；保留兼容 */
  freshThread?: boolean
}): string | undefined {
  if (!isManagerLangGraphCheckpointerEnabled()) return undefined
  const run = String(input.runId || '').trim()
  if (run) return `run-${run}`
  const mode = resolveManagerCheckpointerMode()
  const sid = String(input.sessionId || input.threadId || '').trim()
  if (mode === 'postgres' && sid) return `sess-${sid}`
  return sid ? `sess-${sid}` : undefined
}

export function getManagerCheckpointerStatus() {
  return {
    mode: resolveManagerCheckpointerMode(),
    postgresReady,
    enabled: isManagerLangGraphCheckpointerEnabled()
  }
}
