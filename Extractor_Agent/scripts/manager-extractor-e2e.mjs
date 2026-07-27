/**
 * §8 E2E：总管转发 vs Extractor 直连字段一致率。
 * 用法：npm run eval:e2e [-- --manager=ws://127.0.0.1:13106]
 * 需 Extractor(13104) 运行；Manager 可选（无则仅测直连 + manager_task_json 模拟）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const EXTRACTOR_WS = process.env.EXTRACTOR_WS_URL || 'ws://127.0.0.1:13104/_ws'
const MANAGER_WS = process.env.MANAGER_WS_URL || ''
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS || 90000)

const CASES = [
  {
    name: 'weibo_hot_10',
    task: '帮我看下微博热搜，给我十条',
  },
  {
    name: 'manager_seed_first',
    task: '抓取以下网页摘要',
    manager_task_json: JSON.stringify({
      source: 'manager',
      refined_task: '抓取网页摘要',
      seed_urls: ['https://example.com'],
      preferred_channel: 'browser',
      serp_context: '1. Example Domain\nURL: https://example.com\n示例摘要',
    }),
  },
]

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function cliArg(prefix, fallback) {
  const hit = process.argv.find((x) => String(x).startsWith(`${prefix}=`))
  return hit ? String(hit).slice(prefix.length + 1).trim() || fallback : fallback
}

function itemKeys(items) {
  const keys = new Set()
  for (const it of items || []) {
    if (!it || typeof it !== 'object') continue
    for (const k of Object.keys(it)) keys.add(k)
  }
  return keys
}

function fieldOverlap(a, b) {
  const ka = itemKeys(a)
  const kb = itemKeys(b)
  if (!ka.size && !kb.size) return 1
  let inter = 0
  for (const k of ka) if (kb.has(k)) inter += 1
  const union = new Set([...ka, ...kb]).size
  return union ? inter / union : 0
}

async function callExtractorWs(task, manager_task_json) {
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => finish(new Error(`timeout ${TIMEOUT}ms`)), TIMEOUT)
    let ws
    const finish = (err, payload) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        ws?.close()
      } catch {}
      if (err) reject(err)
      else resolve(payload)
    }
    ws = new WebSocket(EXTRACTOR_WS)
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          payload: {
            task,
            mode: 'crawler',
            ...(manager_task_json ? { manager_task_json } : {}),
          },
        }),
      )
    })
    ws.addEventListener('message', (evt) => {
      const data = parseJson(String(evt?.data || ''))
      if (!data) return
      if (data.type === 'result') finish(null, data.payload || {})
      if (data.type === 'error') finish(new Error(JSON.stringify(data.payload || {})))
    })
    ws.addEventListener('error', (e) => finish(new Error(String(e?.message || 'ws error'))))
  })
}

async function callManagerWs(task) {
  const url = cliArg('--manager', MANAGER_WS)
  if (!url) return null
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => finish(new Error('manager timeout')), TIMEOUT)
    let ws
    const finish = (err, payload) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        ws?.close()
      } catch {}
      if (err) reject(err)
      else resolve(payload)
    }
    ws = new WebSocket(url)
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'start', payload: { message: task } }))
    })
    ws.addEventListener('message', (evt) => {
      const data = parseJson(String(evt?.data || ''))
      if (!data) return
      if (data.type === 'result' || data.event === 'final') finish(null, data.payload || data.data || data)
    })
    ws.addEventListener('error', (e) => finish(new Error(String(e?.message || 'manager ws error'))))
  })
}

async function main() {
  const rows = []
  let overlapSum = 0
  let overlapN = 0

  console.log(`eval:e2e extractor=${EXTRACTOR_WS}`)
  for (const c of CASES) {
    const t0 = Date.now()
    try {
      const direct = await callExtractorWs(c.task, undefined)
      const forwarded = await callExtractorWs(c.task, c.manager_task_json)
      const overlap = fieldOverlap(direct?.items, forwarded?.items)
      overlapSum += overlap
      overlapN += 1
      rows.push({
        name: c.name,
        ok: true,
        ms: Date.now() - t0,
        direct_items: Array.isArray(direct?.items) ? direct.items.length : 0,
        forward_items: Array.isArray(forwarded?.items) ? forwarded.items.length : 0,
        field_overlap: Number(overlap.toFixed(3)),
        direct_status: direct?.status,
        forward_status: forwarded?.status,
        forward_seed_first: Boolean(forwarded?.meta?.seed_first),
      })
      console.log(`  OK ${c.name} overlap=${overlap.toFixed(2)} direct=${direct?.items?.length ?? 0} fwd=${forwarded?.items?.length ?? 0}`)
    } catch (e) {
      rows.push({ name: c.name, ok: false, error: String(e?.message || e) })
      console.log(`  FAIL ${c.name} ${String(e?.message || e)}`)
    }
  }

  const managerUrl = cliArg('--manager', MANAGER_WS)
  if (managerUrl) {
    try {
      const mgr = await callManagerWs(CASES[0].task)
      rows.push({ name: 'manager_live', ok: true, snippet: JSON.stringify(mgr).slice(0, 200) })
      console.log('  manager live call ok')
    } catch (e) {
      rows.push({ name: 'manager_live', ok: false, error: String(e?.message || e) })
      console.log(`  manager live skipped: ${e?.message || e}`)
    }
  }

  const avgOverlap = overlapN ? overlapSum / overlapN : 0
  const report = {
    at: new Date().toISOString(),
    extractor_ws: EXTRACTOR_WS,
    avg_field_overlap: Number(avgOverlap.toFixed(3)),
    target_min_overlap: 0.85,
    pass: avgOverlap >= 0.85,
    rows,
  }
  const out = path.join(process.cwd(), '.data', 'manager-extractor-e2e.json')
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(out, JSON.stringify(report, null, 2), 'utf8')
  console.log(`report -> ${out}`)
  console.log(`avg_field_overlap=${report.avg_field_overlap} target>=${report.target_min_overlap}`)
  process.exit(report.pass && rows.every((r) => r.ok !== false || r.name === 'manager_live') ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
