/**
 * Evolution Hub：聚合四路 GET /api/learning
 */

function internalHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = String(env.CLAWHIVE_INTERNAL_TOKEN || env.AGENT_INTERNAL_TOKEN || '').trim()
  return token ? { 'x-clawhive-internal-token': token } : {}
}

function wsToHttp(wsUrl: string): string {
  return String(wsUrl || '')
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
    .replace(/\/api\/chat\/ws\/?$/i, '')
    .replace(/\/_ws\/?$/i, '')
}

async function fetchLearning(url: string, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; url: string; data?: unknown; error?: string }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/learning`, {
      headers: { accept: 'application/json', ...internalHeaders(env) },
      signal: AbortSignal.timeout(12_000)
    })
    if (!res.ok) return { ok: false, url, error: `HTTP ${res.status}` }
    return { ok: true, url, data: await res.json() }
  } catch (e) {
    return { ok: false, url, error: String((e as Error)?.message || e) }
  }
}

export async function fetchEvolutionHubSummary(env: NodeJS.ProcessEnv = process.env) {
  const dbUrl = String(env.DB_AGENT_HTTP_URL || 'http://localhost:13101').trim()
  const ragUrl = String(env.RAG_AGENT_HTTP_URL || 'http://localhost:13102').trim()
  const adminUrl = String(env.AI_ADMIN_AGENT_HTTP_URL || wsToHttp(env.AI_ADMIN_AGENT_WS_URL || 'ws://localhost:13105/api/chat/ws')).trim()

  const [db, rag, admin] = await Promise.all([
    fetchLearning(dbUrl, env),
    fetchLearning(ragUrl, env),
    fetchLearning(adminUrl, env)
  ])

  return {
    ts: new Date().toISOString(),
    agents: { db, rag, admin },
    ok: db.ok && rag.ok && admin.ok
  }
}

export async function triggerRemoteCurate(
  agent: 'db' | 'rag' | 'admin',
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: boolean; report?: unknown; error?: string }> {
  const base =
    agent === 'db'
      ? String(env.DB_AGENT_HTTP_URL || 'http://localhost:13101')
      : agent === 'rag'
        ? String(env.RAG_AGENT_HTTP_URL || 'http://localhost:13102')
        : String(env.AI_ADMIN_AGENT_HTTP_URL || wsToHttp(env.AI_ADMIN_AGENT_WS_URL || ''))

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/learning/curate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...internalHeaders(env) },
      body: JSON.stringify({ autoPromote: false }),
      signal: AbortSignal.timeout(30_000)
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, report: await res.json() }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

export async function runEvolutionHubAudit(env: NodeJS.ProcessEnv = process.env) {
  const { runUnifiedEvoAuditJob } = await import('#agent-shared/evoAuditJob')
  const audit = await runUnifiedEvoAuditJob(env)
  const summary = await fetchEvolutionHubSummary(env)
  const curators = await Promise.all([
    triggerRemoteCurate('db', env),
    triggerRemoteCurate('rag', env),
    triggerRemoteCurate('admin', env)
  ])
  return { audit, summary, curators }
}
