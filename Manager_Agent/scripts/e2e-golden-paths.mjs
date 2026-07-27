/**
 * P0-2：总管黄金路径 E2E（WS 真链路；无 Agent 时可 E2E_SKIP_IF_NO_AGENTS=1 跳过）
 * 用法：npm run e2e:golden [-- --manager=ws://127.0.0.1:13106/api/manager-ws]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const CASES_FILE = path.join(root, 'eval', 'golden-e2e-paths.json')

const MANAGER_WS = process.env.MANAGER_WS_URL || 'ws://127.0.0.1:13106/api/manager-ws'
const MANAGER_WS_TOKEN = String(
  process.env.MANAGER_WS_TOKEN || process.env.CLAWHIVE_INTERNAL_TOKEN || ''
).trim()

function withManagerWsAuthPayload(payload) {
  return MANAGER_WS_TOKEN ? { ...payload, wsToken: MANAGER_WS_TOKEN } : payload
}

function managerWsConnectUrl(baseUrl) {
  const u = String(baseUrl || MANAGER_WS).trim()
  if (!MANAGER_WS_TOKEN) return u
  const sep = u.includes('?') ? '&' : '?'
  return `${u}${sep}token=${encodeURIComponent(MANAGER_WS_TOKEN)}`
}
const RAG_HTTP = process.env.RAG_AGENT_HTTP_URL || 'http://127.0.0.1:13102'
const DB_HTTP = process.env.DB_AGENT_HTTP_URL || 'http://127.0.0.1:13101'
const CRAWLER_HTTP = process.env.CRAWLER_AGENT_HTTP_URL || 'http://127.0.0.1:13104'
const SKIP_IF_OFFLINE = String(process.env.E2E_SKIP_IF_NO_AGENTS ?? '1').trim() !== '0'
const DEFAULT_TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS || 180_000)

function cliArg(prefix, fallback) {
  const hit = process.argv.find((x) => String(x).startsWith(`${prefix}=`))
  return hit ? String(hit).slice(prefix.length + 1).trim() || fallback : fallback
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function textIncludesAny(text, markers) {
  const t = String(text || '').toLowerCase()
  for (const m of markers || []) {
    if (t.includes(String(m).toLowerCase())) return true
  }
  return false
}

async function probeReady(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (!base) return false
  try {
    const res = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(12_000) })
    if (res.ok) {
      const body = await res.json().catch(() => ({}))
      return Boolean(body.ready ?? body.ok)
    }
  } catch {}
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return false
    const body = await res.json().catch(() => ({}))
    return Boolean(body.ready ?? body.ok ?? true)
  } catch {
    return false
  }
}

async function preflight() {
  const ragOk = await probeReady(RAG_HTTP)
  const dbOk = await probeReady(DB_HTTP)
  const crawlerOk = await probeReady(CRAWLER_HTTP)
  return { ragOk, dbOk, crawlerOk, anyOk: ragOk || dbOk || crawlerOk }
}

function runManagerCase(caseDef, managerUrl) {
  const timeoutMs = Number(caseDef.expect?.maxDurationMs || DEFAULT_TIMEOUT)
  const sessionId = `e2e-${caseDef.id}-${Date.now()}`

  return new Promise((resolve, reject) => {
    const events = []
    let finalText = ''
    let sawHumanConfirm = false
    let sawAgentError = false
    let done = false
    const prevEnv = {}
    if (caseDef.env && typeof caseDef.env === 'object') {
      for (const [k, v] of Object.entries(caseDef.env)) {
        prevEnv[k] = process.env[k]
        process.env[k] = String(v)
      }
    }

    const finish = (err, payload) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      try {
        ws?.close()
      } catch {}
      if (err) reject(err)
      else resolve(payload)
    }

    const timer = setTimeout(() => finish(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)
    let ws

    ws = new WebSocket(managerWsConnectUrl(managerUrl))
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify(
          withManagerWsAuthPayload({
            type: 'chat',
            sessionId,
            text: String(caseDef.text || ''),
            ...(caseDef.forceIntent ? { forceIntent: caseDef.forceIntent } : {})
          })
        )
      )
    })
    ws.addEventListener('message', (evt) => {
      const msg = parseJson(String(evt?.data || ''))
      if (!msg) return
      events.push(msg)
      const ev = String(msg.event || '')
      if (ev === 'agent_error') sawAgentError = true
      if (ev === 'human_confirm_request') {
        sawHumanConfirm = true
        ws.send(JSON.stringify(withManagerWsAuthPayload({ type: 'human_confirm', sessionId, decision: 'cancel' })))
        if (caseDef.expect?.expectHumanConfirm && !caseDef.expect?.mustFinal) {
          finish(null, { events, finalText, sawHumanConfirm, sawAgentError })
        }
        return
      }
      if (ev === 'final') {
        finalText = typeof msg.data === 'string' ? msg.data : String(msg.data?.text || msg.data || '')
        finish(null, { events, finalText, sawHumanConfirm, sawAgentError })
      }
      if (ev === 'error') {
        finish(new Error(String(msg.data || 'manager error')))
      }
    })
    ws.addEventListener('error', (e) => finish(new Error(String(e?.message || 'ws error'))))
    ws.addEventListener('close', () => {
      if (!done) finish(new Error('ws closed before final'))
    })
  })
}

function assertCase(caseDef, result) {
  const ex = caseDef.expect || {}
  if (ex.mustFinal && !String(result.finalText || '').trim()) {
    throw new Error(`${caseDef.id}: missing final`)
  }
  if (ex.mustNotAgentError && result.sawAgentError) {
    throw new Error(`${caseDef.id}: saw agent_error`)
  }
  if (ex.expectHumanConfirm) {
    if (!result.sawHumanConfirm) throw new Error(`${caseDef.id}: expected human_confirm_request`)
    return
  }
  if (Array.isArray(ex.finalNotContains) && textIncludesAny(result.finalText, ex.finalNotContains)) {
    throw new Error(`${caseDef.id}: final contains blocked marker`)
  }
  if (Array.isArray(ex.finalContains) && !textIncludesAny(result.finalText, ex.finalContains)) {
    throw new Error(`${caseDef.id}: final missing expected marker`)
  }
}

async function main() {
  const spec = parseJson(await fs.readFile(CASES_FILE, 'utf8'))
  const cases = Array.isArray(spec?.cases) ? spec.cases : []
  if (!cases.length) throw new Error('no e2e cases')

  const managerUrl = cliArg('--manager', MANAGER_WS)
  const pf = await preflight()
  if (!pf.anyOk && SKIP_IF_OFFLINE) {
    console.log('e2e:golden SKIP (sub-agents offline, E2E_SKIP_IF_NO_AGENTS=1)')
    return
  }
  if (!pf.anyOk) throw new Error('sub-agents offline; set E2E_SKIP_IF_NO_AGENTS=1 to skip')

  const report = []
  for (const c of cases) {
    const t0 = Date.now()
    try {
      const result = await runManagerCase(c, managerUrl)
      assertCase(c, result)
      report.push({ id: c.id, ok: true, ms: Date.now() - t0 })
      console.log(`e2e ok: ${c.id} (${Date.now() - t0}ms)`)
    } catch (e) {
      report.push({ id: c.id, ok: false, ms: Date.now() - t0, error: String(e?.message || e) })
      throw e
    }
  }

  const outDir = path.join(root, '.data')
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, 'e2e-golden-report.json'), JSON.stringify({ at: new Date().toISOString(), report }, null, 2))
  console.log('e2e:golden all ok')
}

main().catch((e) => {
  console.error(String(e?.message || e))
  process.exit(1)
})
