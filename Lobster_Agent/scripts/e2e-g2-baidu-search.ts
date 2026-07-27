/**
 * G2 / IL1 黄金路径 E2E：百度搜索（容器或本地 Lobster HTTP）
 * 通过：无 _zod；有 agentResult（或 result.answer）；不进 news.baidu.com；
 * CAPTCHA / need_human 计为可接受的 HITL 结局（exit 0 + CAPTCHA_HITL）
 */
const BASE_URL = String(process.env.LOBSTER_BASE_URL || 'http://127.0.0.1:13108').replace(/\/+$/, '')
const TOKEN = String(process.env.LOBSTER_ADMIN_TOKEN || process.env.CLAWHIVE_INTERNAL_TOKEN || '').trim()
const TASK =
  String(process.env.LOBSTER_E2E_TASK || '').trim() ||
  '打开百度搜索「Python 教程」，提取第一条结果'
const START_URL = String(process.env.LOBSTER_E2E_START_URL || 'https://www.baidu.com').trim()
const TIMEOUT_MS = Math.max(60_000, Number(process.env.LOBSTER_E2E_TIMEOUT_MS || 240_000))

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

function failureTypeOf(row: Record<string, unknown>): string {
  const ar = row.agentResult && typeof row.agentResult === 'object' ? (row.agentResult as any) : null
  const result = row.result && typeof row.result === 'object' ? (row.result as any) : {}
  return String(
    ar?.structured?.failureType ||
      ar?.error_code ||
      result.failureType ||
      row.error ||
      '',
  )
    .trim()
    .toLowerCase()
}

async function main() {
  const ready = await getJson(`${BASE_URL}/api/ready`).catch((e) => {
    throw new Error(`ready 失败：${e?.message || e}`)
  })
  if (!ready?.ready) throw new Error(`lobster not ready: ${JSON.stringify(ready).slice(0, 200)}`)

  const start = await postJson(`${BASE_URL}/api/lobster/start`, {
    task: TASK,
    startUrl: START_URL,
    engineHint: 'auto',
  })
  const runId = String(start?.runId || '').trim()
  if (!runId) throw new Error('start failed: no runId')
  console.log(`[e2e-g2] started runId=${runId}`)

  const deadline = Date.now() + TIMEOUT_MS
  let last: Record<string, unknown> = {}
  while (Date.now() < deadline) {
    last = (await getJson(`${BASE_URL}/api/lobster/status?runId=${encodeURIComponent(runId)}`)) || {}
    const status = String(last.status || '')
    if (status === 'done' || status === 'error' || status === 'canceled') break
    await sleep(2500)
  }

  const status = String(last.status || '')
  const result = (last.result && typeof last.result === 'object' ? last.result : {}) as Record<string, unknown>
  const agentResult =
    last.agentResult && typeof last.agentResult === 'object' ? (last.agentResult as Record<string, unknown>) : null
  const finalUrl = String(result.finalUrl || result.url || agentResult?.structured && (agentResult.structured as any).finalUrl || '').trim()
  const answer = String(agentResult?.answer || result.answer || '').trim()
  const engine = String(result.engine || result.executionEngine || '').trim()
  const ft = failureTypeOf(last)

  if (/news\.baidu\.com|map\.baidu\.com|tieba\.baidu\.com/i.test(finalUrl)) {
    throw new Error(`wrong_channel: ${finalUrl}`)
  }
  if (/_zod/i.test(String(last.error || answer))) {
    throw new Error(`_zod crash remnant: ${String(last.error || answer).slice(0, 120)}`)
  }

  const captchaUrl = /wappass\.baidu\.com|\/captcha|安全验证|验证码/i.test(`${finalUrl}\n${answer}`)
  if (ft === 'captcha' || ft === 'need_human' || ft === 'need_login' || captchaUrl) {
    console.log(
      `[e2e-g2] CAPTCHA_HITL ok runId=${runId} status=${status} engine=${engine || '-'} ft=${ft || 'captcha_url'} url=${finalUrl || '-'}`,
    )
    return
  }

  if (status !== 'done') {
    throw new Error(`run ${status || 'timeout'}: ${String(last.error || ft || '')}`)
  }
  if (!agentResult && !answer) {
    throw new Error('missing agentResult/answer (协议未对齐)')
  }
  if (!answer || answer.length < 6) {
    throw new Error(`empty/short answer: ${answer.slice(0, 80)}`)
  }

  const onResults = /\/s\?|[?&]wd=|search\./i.test(finalUrl) || /结果页|Python|教程/i.test(answer)
  if (!onResults && !/example\.com|runoob|python/i.test(finalUrl + answer)) {
    console.warn(`[e2e-g2] WARN: URL 未必结果态 finalUrl=${finalUrl}`)
  }

  console.log(
    `[e2e-g2] PASS runId=${runId} engine=${engine || '-'} hasAgentResult=${!!agentResult} url=${finalUrl.slice(0, 80)} answer=${answer.slice(0, 100)}`,
  )
}

main().catch((e) => {
  console.error(`[e2e-g2] FAIL: ${(e as Error)?.message || e}`)
  process.exit(1)
})
