/**
 * G4 黄金路径 E2E：Windows 桌面记事本（需 Win 宿主机 + LOBSTER_DESKTOP_MCP_ENABLED=1 + Lobster 运行中）
 */
import { verifyLobsterRunResult } from '../../shared/lobsterRunVerifyLite'
import { isLobsterDesktopMcpEnabled } from '../server/utils/lobster_env'

const BASE_URL = String(process.env.LOBSTER_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const TOKEN = String(process.env.LOBSTER_ADMIN_TOKEN || '').trim()
const TASK = '打开记事本，输入 Hello World，保存到桌面。'

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
  if (!isLobsterDesktopMcpEnabled()) {
    console.log('[e2e-g4] SKIP: LOBSTER_DESKTOP_MCP_ENABLED!=1')
    return
  }
  if (process.platform !== 'win32') {
    console.log('[e2e-g4] SKIP: requires win32 host')
    return
  }

  const start = await postJson(`${BASE_URL}/api/lobster/start`, {
    task: TASK,
    engineHint: 'desktop',
  })
  const runId = String(start?.runId || '').trim()
  if (!runId) throw new Error('start failed: no runId')

  const deadline = Date.now() + 300_000
  let last: Record<string, unknown> = {}
  while (Date.now() < deadline) {
    last = (await getJson(`${BASE_URL}/api/lobster/status?runId=${encodeURIComponent(runId)}`)) || {}
    const status = String(last.status || '')
    if (status === 'done') break
    if (status === 'error' || status === 'canceled') {
      throw new Error(`run ${status}: ${String(last.error || '')}`)
    }
    await sleep(2000)
  }
  if (String(last.status) !== 'done') throw new Error('timeout')

  const verify = verifyLobsterRunResult({
    task: TASK,
    status: 'done',
    result: last.result,
    error: String(last.error || ''),
  })
  if (!verify.ok) {
    throw new Error(`verify failed: ${verify.reason}`)
  }
  console.log(`[e2e-g4] PASS runId=${runId} engine=${String((last.result as any)?.engine || 'desktop')}`)
}

main().catch((e) => {
  console.error(`[e2e-g4] FAIL: ${(e as Error)?.message || e}`)
  process.exit(1)
})
