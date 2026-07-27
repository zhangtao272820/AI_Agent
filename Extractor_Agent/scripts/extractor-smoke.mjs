import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_WS_URL = process.env.EXTRACTOR_WS_URL || 'ws://127.0.0.1:13104/_ws'
const DEFAULT_TIMEOUT_MS = Number.isFinite(Number(process.env.SMOKE_TIMEOUT_MS))
  ? Math.max(3000, Math.floor(Number(process.env.SMOKE_TIMEOUT_MS)))
  : 45000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function getCliArg(prefix, fallback) {
  const hit = process.argv.find((x) => String(x).startsWith(`${prefix}=`))
  if (!hit) return fallback
  const value = String(hit).slice(prefix.length + 1).trim()
  return value || fallback
}

function toWsPayload(obj) {
  return JSON.stringify(obj)
}

async function loadCases() {
  const p = path.join(process.cwd(), 'scripts', 'extractor-smoke-cases.json')
  const raw = await fs.readFile(p, 'utf8')
  const parsed = safeJsonParse(raw)
  if (!Array.isArray(parsed)) throw new Error('smoke cases must be an array')
  return parsed
}

function getFieldValue(item, key) {
  const v = item?.[key]
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  return String(v).trim()
}

function validateCaseResult(oneCase, result, strictMode) {
  const errors = []
  const warnings = []
  const expected = String(oneCase.expectStatus || 'ok').trim()
  const status = String(result?.status || 'ok').trim()
  if (expected && status !== expected) {
    errors.push(`status mismatch: expected=${expected} actual=${status}`)
  }
  const items = Array.isArray(result?.items) ? result.items : []
  const minItems = Number.isFinite(Number(oneCase.minItems)) ? Math.max(0, Number(oneCase.minItems)) : 0
  if (items.length < minItems) {
    const msg = `items too few: expected>=${minItems} actual=${items.length}`
    if (strictMode) errors.push(msg)
    else warnings.push(msg)
  }
  const requiredFields = Array.isArray(oneCase.requiredFields) ? oneCase.requiredFields.map((x) => String(x)) : []
  for (const f of requiredFields) {
    const nonEmpty = items.filter((it) => getFieldValue(it, f)).length
    const ratio = items.length === 0 ? 0 : nonEmpty / items.length
    if (items.length > 0 && ratio < 0.6) {
      const msg = `field coverage low: field=${f} ratio=${ratio.toFixed(2)}`
      if (strictMode) errors.push(msg)
      else warnings.push(msg)
    }
  }
  if (oneCase.expectSeedFirst === true) {
    const seedFirst = Boolean(result?.meta?.seed_first || result?.plan?.target === 'manager_seeds')
    if (!seedFirst) {
      errors.push('expected seed-first planner but meta.seed_first is false')
    }
  }
  const maxItems = Number.isFinite(Number(oneCase.maxItems)) ? Math.max(0, Number(oneCase.maxItems)) : null
  if (maxItems != null && items.length > maxItems) {
    errors.push(`items too many: expected<=${maxItems} actual=${items.length}`)
  }
  const expectSite = String(oneCase.expectTaskSite || '').trim()
  if (expectSite) {
    const actualSite = String(result?.taskPlan?.targetSite || '').trim()
    if (actualSite !== expectSite) {
      errors.push(`task site mismatch: expected=${expectSite} actual=${actualSite || '(empty)'}`)
    }
  }
  const seedPattern = String(oneCase.expectSeedPattern || '').trim()
  if (seedPattern) {
    const seed = String(result?.plan?.seedUrls?.[0] || '').trim()
    if (!seed || !new RegExp(seedPattern, 'i').test(seed)) {
      errors.push(`seed mismatch: expected~/${seedPattern}/ actual=${seed || '(empty)'}`)
    }
  }
  if (oneCase.expectNoCloudScrape === true) {
    const cloudCalls = Number(result?.meta?.cloud_scrape_calls ?? 0)
    if (cloudCalls > 0) {
      errors.push(`unexpected cloud scrape: calls=${cloudCalls}`)
    }
  }
  return { errors, warnings, status, itemCount: items.length }
}

async function runOneCase(wsUrl, oneCase, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false
    let timer = null
    let ws
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      timer = null
      try {
        ws?.close()
      } catch {}
    }
    const done = (payload, isError = false) => {
      if (finished) return
      finished = true
      cleanup()
      if (isError) reject(payload)
      else resolve(payload)
    }
    try {
      ws = new WebSocket(wsUrl)
    } catch (e) {
      done(new Error(`failed to create websocket: ${String(e?.message || e)}`), true)
      return
    }
    timer = setTimeout(() => done(new Error(`timeout after ${timeoutMs}ms`), true), timeoutMs)
    ws.addEventListener('open', () => {
      const msg = {
        type: 'start',
        payload: {
          task: String(oneCase.task || ''),
          mode: 'crawler',
          ...(oneCase.manager_task_json
            ? { manager_task_json: String(oneCase.manager_task_json) }
            : {}),
        }
      }
      ws.send(toWsPayload(msg))
    })
    ws.addEventListener('message', (evt) => {
      const data = safeJsonParse(String(evt?.data || ''))
      if (!data || typeof data !== 'object') return
      const type = String(data.type || '')
      if (type === 'error') {
        done(new Error(`server error: ${JSON.stringify(data.payload || {})}`), true)
        return
      }
      if (type === 'result') {
        done(data.payload || {})
      }
    })
    ws.addEventListener('error', (evt) => {
      done(new Error(`websocket error: ${String(evt?.message || 'unknown')}`), true)
    })
  })
}

async function main() {
  const wsUrl = getCliArg('--ws', DEFAULT_WS_URL)
  const timeoutMs = Number(getCliArg('--timeout', String(DEFAULT_TIMEOUT_MS)))
  const strictMode = process.argv.includes('--strict')
  const reportDir = path.join(process.cwd(), '.data')
  const reportFile = path.join(reportDir, `extractor-smoke-report-${strictMode ? 'strict' : 'default'}.json`)
  const cases = await loadCases()
  console.log(`Extractor smoke start: cases=${cases.length} ws=${wsUrl} strict=${strictMode}`)

  const rows = []
  let failed = 0
  for (const oneCase of cases) {
    const name = String(oneCase.name || oneCase.task || 'unnamed_case')
    const t0 = Date.now()
    try {
      const result = await runOneCase(wsUrl, oneCase, timeoutMs)
      const checked = validateCaseResult(oneCase, result, strictMode)
      const ms = Date.now() - t0
      if (checked.errors.length > 0) {
        failed += 1
        rows.push({ name, ok: false, ms, message: checked.errors.join('; ') })
      } else {
        const warnText = checked.warnings.length > 0 ? ` warnings=${checked.warnings.join('|')}` : ''
        rows.push({ name, ok: true, ms, message: `status=${checked.status} items=${checked.itemCount}${warnText}` })
      }
    } catch (e) {
      failed += 1
      rows.push({ name, ok: false, ms: Date.now() - t0, message: String(e?.message || e) })
    }
    await sleep(300)
  }

  console.log('')
  for (const r of rows) {
    const tag = r.ok ? 'PASS' : 'FAIL'
    console.log(`[${tag}] ${r.name} (${r.ms}ms) - ${r.message}`)
  }
  console.log('')
  console.log(`Extractor smoke done: pass=${rows.length - failed} fail=${failed} total=${rows.length}`)
  await fs.mkdir(reportDir, { recursive: true })
  const reportPayload = {
    ts: new Date().toISOString(),
    strictMode,
    wsUrl,
    timeoutMs,
    summary: {
      pass: rows.length - failed,
      fail: failed,
      total: rows.length
    },
    rows
  }
  await fs.writeFile(reportFile, `${JSON.stringify(reportPayload, null, 2)}\n`, 'utf8')
  console.log(`Extractor smoke report: ${reportFile}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(`Extractor smoke fatal: ${String(e?.message || e)}`)
  process.exit(1)
})
