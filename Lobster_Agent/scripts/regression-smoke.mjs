import fs from 'node:fs/promises'
import path from 'node:path'

const BASE_URL = String(process.env.LOBSTER_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const TOKEN = String(process.env.LOBSTER_ADMIN_TOKEN || '').trim()
const CASES_FILE = process.env.LOBSTER_CASES_FILE
  ? path.resolve(process.env.LOBSTER_CASES_FILE)
  : path.resolve(process.cwd(), 'scripts', 'regression-cases.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function authHeaders() {
  if (!TOKEN) return {}
  return { 'x-lobster-token': TOKEN, Authorization: `Bearer ${TOKEN}` }
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body || {})
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text || '<empty>'}`)
  }
  return json
}

async function getJson(url) {
  const res = await fetch(url, { headers: { ...authHeaders() } })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text || '<empty>'}`)
  }
  return json
}

function normalizeCase(raw, i) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const name = String(c.name || `case-${i + 1}`).trim()
  const task = String(c.task || '').trim()
  const startUrl = c.startUrl ? String(c.startUrl).trim() : ''
  const timeoutSecRaw = Number(c.timeoutSec || 120)
  const timeoutSec = Number.isFinite(timeoutSecRaw) && timeoutSecRaw > 0 ? Math.floor(timeoutSecRaw) : 120
  if (!task) throw new Error(`测试用例缺少 task: ${name}`)
  return { name, task, startUrl, timeoutSec }
}

async function runCase(c) {
  const payload = c.startUrl ? { task: c.task, startUrl: c.startUrl } : { task: c.task }
  const start = await postJson(`${BASE_URL}/api/lobster/start`, payload)
  const runId = String(start?.runId || '').trim()
  if (!runId) throw new Error(`[${c.name}] 启动失败：无 runId`)
  const deadline = Date.now() + c.timeoutSec * 1000
  let lastStatus = 'unknown'
  let lastError = ''
  while (Date.now() < deadline) {
    const st = await getJson(`${BASE_URL}/api/lobster/status?runId=${encodeURIComponent(runId)}`)
    lastStatus = String(st?.status || 'unknown')
    lastError = String(st?.error || '')
    if (lastStatus === 'done') {
      const engine = String(st?.result?.engine || st?.result?.executionEngine || '').trim()
      return {
        ok: true,
        runId,
        status: lastStatus,
        finalUrl: String(st?.state?.pageUrl || st?.result?.finalUrl || ''),
        engine: engine || undefined,
        hasResult: !!st?.result
      }
    }
    if (lastStatus === 'error' || lastStatus === 'canceled') {
      return { ok: false, runId, status: lastStatus, error: lastError || 'run_failed' }
    }
    await sleep(2000)
  }
  await postJson(`${BASE_URL}/api/lobster/stop`, { runId }).catch(() => {})
  return { ok: false, runId, status: lastStatus, error: `timeout_${c.timeoutSec}s` }
}

async function main() {
  const raw = await fs.readFile(CASES_FILE, 'utf8')
  const arr = JSON.parse(raw)
  if (!Array.isArray(arr) || !arr.length) {
    throw new Error(`无有效测试用例: ${CASES_FILE}`)
  }
  const cases = arr.map(normalizeCase)
  console.log(`Smoke regression started (${cases.length} cases)`)
  console.log(`Base URL: ${BASE_URL}`)
  console.log(`Auth token: ${TOKEN ? 'enabled' : 'disabled'}`)
  const results = []
  for (const c of cases) {
    console.log(`\n[RUN] ${c.name}`)
    console.log(`task: ${c.task}`)
    const out = await runCase(c)
    results.push({ case: c.name, ...out })
    if (out.ok) console.log(`[PASS] ${c.name} runId=${out.runId} status=${out.status} engine=${out.engine || '-'} hasResult=${out.hasResult ? 1 : 0}`)
    else console.log(`[FAIL] ${c.name} runId=${out.runId} status=${out.status} error=${out.error || ''}`)
  }
  const pass = results.filter((x) => x.ok).length
  const fail = results.length - pass
  console.log(`\nSummary: pass=${pass} fail=${fail}`)
  if (fail > 0) {
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(`Regression failed: ${e?.message || e}`)
  process.exit(1)
})
