/**
 * G3 / IL2：runoob 点第一个教程（容器内较低风控）
 */
const BASE_URL = String(process.env.LOBSTER_BASE_URL || 'http://127.0.0.1:13108').replace(/\/+$/, '')
const TOKEN = String(process.env.LOBSTER_ADMIN_TOKEN || process.env.CLAWHIVE_INTERNAL_TOKEN || '').trim()
const TASK =
  String(process.env.LOBSTER_E2E_TASK || '').trim() ||
  '打开 https://www.runoob.com/ 点击第一个教程链接，并告诉我标题和 URL'
const START_URL = String(process.env.LOBSTER_E2E_START_URL || 'https://www.runoob.com/').trim()
const TIMEOUT_MS = Math.max(60_000, Number(process.env.LOBSTER_E2E_TIMEOUT_MS || 180_000))

function authHeaders(): Record<string, string> {
  if (!TOKEN) return {}
  return { 'x-lobster-token': TOKEN, Authorization: `Bearer ${TOKEN}` }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body || {}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text || '<empty>'}`)
  return text ? JSON.parse(text) : null
}

async function getJson(url: string) {
  const res = await fetch(url, { headers: { ...authHeaders() } })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text || '<empty>'}`)
  return text ? JSON.parse(text) : null
}

async function main() {
  const ready = await getJson(`${BASE_URL}/api/ready`)
  if (!ready?.ready) throw new Error(`not ready: ${JSON.stringify(ready).slice(0, 160)}`)

  const start = await postJson(`${BASE_URL}/api/lobster/start`, {
    task: TASK,
    startUrl: START_URL,
    // auto：MCP 失败时回退 classic（容器验证更稳）
    engineHint: String(process.env.LOBSTER_E2E_ENGINE || 'auto'),
  })
  const runId = String(start?.runId || '').trim()
  if (!runId) throw new Error('no runId')
  console.log(`[e2e-g3] started runId=${runId}`)

  const deadline = Date.now() + TIMEOUT_MS
  let last: Record<string, unknown> = {}
  while (Date.now() < deadline) {
    last = (await getJson(`${BASE_URL}/api/lobster/status?runId=${encodeURIComponent(runId)}`)) || {}
    const status = String(last.status || '')
    if (status === 'done' || status === 'error' || status === 'canceled') break
    await sleep(2000)
  }

  const status = String(last.status || '')
  const result = (last.result && typeof last.result === 'object' ? last.result : {}) as Record<string, unknown>
  const agentResult =
    last.agentResult && typeof last.agentResult === 'object' ? (last.agentResult as Record<string, unknown>) : null
  const answer = String(agentResult?.answer || result.answer || '').trim()
  const finalUrl = String(result.finalUrl || '').trim()
  const engine = String(result.engine || result.executionEngine || '').trim()

  if (status !== 'done') throw new Error(`run ${status}: ${String(last.error || '')}`)
  if (!agentResult && !answer) throw new Error('missing agentResult/answer')
  if (answer.length < 6) throw new Error(`short answer: ${answer}`)

  console.log(
    `[e2e-g3] PASS runId=${runId} engine=${engine || '-'} hasAgentResult=${!!agentResult} url=${finalUrl.slice(0, 80)} answer=${answer.slice(0, 100)}`,
  )
}

main().catch((e) => {
  console.error(`[e2e-g3] FAIL: ${(e as Error)?.message || e}`)
  process.exit(1)
})
