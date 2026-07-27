/**
 * G5 黄金路径 E2E：用户 Chrome CDP 附着（需 LOBSTER_BROWSER_PROFILE=user + LOBSTER_BROWSER_CDP_URL + Lobster 运行中）
 */
import { isUserBrowserProfile, resolveBrowserCdpUrl } from '../server/services/browserProfiles'

const BASE_URL = String(process.env.LOBSTER_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const TOKEN = String(process.env.LOBSTER_ADMIN_TOKEN || '').trim()
const TASK = '打开 https://www.baidu.com/ 搜索 LangGraph 并打开第一条结果'

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
  const cdp = resolveBrowserCdpUrl()
  if (!cdp) {
    console.log('[e2e-g5] SKIP: LOBSTER_BROWSER_CDP_URL not set')
    return
  }
  if (!isUserBrowserProfile()) {
    console.log('[e2e-g5] SKIP: LOBSTER_BROWSER_PROFILE!=user or CDP inactive')
    return
  }

  const start = await postJson(`${BASE_URL}/api/lobster/start`, {
    task: TASK,
    startUrl: 'https://www.baidu.com/',
    engineHint: 'auto',
    browser_profile: 'user',
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

  const result = (last.result && typeof last.result === 'object' ? last.result : {}) as Record<string, unknown>
  const engine = String(result.engine || result.executionEngine || '').trim()
  const answer = String(result.answer || '').trim()
  if (!answer) throw new Error('empty answer')
  console.log(`[e2e-g5] PASS runId=${runId} engine=${engine || '-'} answer=${answer.slice(0, 80)}`)
}

main().catch((e) => {
  console.error(`[e2e-g5] FAIL: ${(e as Error)?.message || e}`)
  process.exit(1)
})
