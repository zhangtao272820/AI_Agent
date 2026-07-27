/**
 * Extractor 回归评估 + §8 验收指标基线。
 * 用法：
 *   npm run eval:extractor [-- --ws=ws://127.0.0.1:13104/_ws]
 *   npm run eval:extractor -- --write-baseline
 *   npm run eval:extractor -- --compare-baseline
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_WS = process.env.EXTRACTOR_WS_URL || 'ws://127.0.0.1:13104/_ws'
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS || 45000)
const BASELINE_FILE = path.join(process.cwd(), 'scripts', 'extractor-eval-baseline.json')

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

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

function hasFlag(name) {
  return process.argv.includes(name)
}

async function loadCases() {
  const p = path.join(process.cwd(), 'scripts', 'extractor-smoke-cases.json')
  const raw = await fs.readFile(p, 'utf8')
  const parsed = parseJson(raw)
  if (!Array.isArray(parsed)) throw new Error('cases must be array')
  return parsed
}

async function runCase(wsUrl, oneCase) {
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
    try {
      ws = new WebSocket(wsUrl)
    } catch (e) {
      finish(e)
      return
    }
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          payload: {
            task: String(oneCase.task || ''),
            mode: 'crawler',
            ...(oneCase.manager_task_json ? { manager_task_json: String(oneCase.manager_task_json) } : {}),
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

function isPatchOrTemplatePath(pathKey) {
  const p = String(pathKey || '').toLowerCase()
  return p.includes('patch') || p.includes('template') || p.includes('rule') || p.includes('builtin')
}

function buildAcceptance(rows, stats) {
  const finished = rows.filter((r) => r.ok && !r.error)
  const withItems = finished.filter((r) => (r.items ?? 0) > 0)
  const emptyResults = finished.filter((r) => (r.items ?? 0) === 0 && r.status !== 'needs_clarification')
  const seedCases = rows.filter((r) => r.expectSeedFirst)
  const bingDup = seedCases.filter((r) => r.bing_extract_violation)
  const cloudScrape = finished.reduce((n, r) => n + Number(r.cloud_scrape_calls || 0), 0)
  const urlFetches = finished.reduce((n, r) => n + Math.max(1, Number(r.urls_fetched || 1)), 0)

  const patchTemplateHits = finished.filter((r) => isPatchOrTemplatePath(r.extract_path)).length
  const patchTemplateRatio = finished.length ? patchTemplateHits / finished.length : 0
  const emptyResultRate = finished.length ? emptyResults.length / finished.length : 0
  const cloudScrapeRatio = urlFetches ? cloudScrape / urlFetches : 0
  const seedBingDupRate = seedCases.length ? bingDup.length / seedCases.length : 0

  return {
    pass_rate: stats.total ? stats.ok / stats.total : 0,
    empty_result_rate: Number(emptyResultRate.toFixed(3)),
    patch_template_ratio: Number(patchTemplateRatio.toFixed(3)),
    cloud_scrape_ratio: Number(cloudScrapeRatio.toFixed(3)),
    seed_bing_dup_rate: Number(seedBingDupRate.toFixed(3)),
    seed_first_count: stats.seed_first,
    serp_fallback_count: stats.serp_fallback,
    llm_extract_calls_total: stats.llm_calls,
    extract_paths: stats.extract_paths,
    targets: {
      seed_bing_dup_rate_max: 0,
      patch_template_ratio_min: 0.4,
      cloud_scrape_ratio_max: 0.15,
      empty_result_rate_max: 0.5,
    },
  }
}

function gateAcceptance(acceptance, baseline) {
  const t = baseline?.targets ?? acceptance.targets
  const violations = []
  if (acceptance.seed_bing_dup_rate > (t.seed_bing_dup_rate_max ?? 0)) {
    violations.push(`seed_bing_dup_rate ${acceptance.seed_bing_dup_rate} > ${t.seed_bing_dup_rate_max}`)
  }
  if (acceptance.patch_template_ratio < (t.patch_template_ratio_min ?? 0)) {
    violations.push(`patch_template_ratio ${acceptance.patch_template_ratio} < ${t.patch_template_ratio_min}`)
  }
  if (acceptance.cloud_scrape_ratio > (t.cloud_scrape_ratio_max ?? 1)) {
    violations.push(`cloud_scrape_ratio ${acceptance.cloud_scrape_ratio} > ${t.cloud_scrape_ratio_max}`)
  }
  return violations
}

async function main() {
  const wsUrl = cliArg('--ws', DEFAULT_WS)
  const writeBaseline = hasFlag('--write-baseline')
  const compareBaseline = hasFlag('--compare-baseline')
  const cases = await loadCases()
  const rows = []
  const stats = {
    total: cases.length,
    ok: 0,
    llm_calls: 0,
    template_hits: 0,
    patch_hits: 0,
    seed_first: 0,
    serp_fallback: 0,
    extract_paths: {},
  }

  console.log(`eval:extractor start cases=${cases.length} ws=${wsUrl}`)
  for (const c of cases) {
    const name = String(c.name || c.task || 'case')
    const expectSeedFirst = Boolean(c.expectSeedFirst || c.manager_task_json)
    const t0 = Date.now()
    try {
      const result = await runCase(wsUrl, c)
      const ms = Date.now() - t0
      const meta = result?.meta || {}
      const pathKey = String(meta.extract_path || 'unknown')
      stats.extract_paths[pathKey] = (stats.extract_paths[pathKey] || 0) + 1
      if (meta.llm_extract_calls) stats.llm_calls += Number(meta.llm_extract_calls)
      if (meta.template_hit) stats.template_hits += 1
      if (meta.patch_hit) stats.patch_hits += 1
      if (meta.seed_first) stats.seed_first += 1
      if (meta.serp_fallback_used || meta.serp_fallback) stats.serp_fallback += 1
      const items = Array.isArray(result?.items) ? result.items.length : 0
      const status = String(result?.status || '')
      const ok = status === 'ok' || status === 'partial_ok' || status === 'needs_clarification'
      if (ok) stats.ok += 1
      const bingViolation = expectSeedFirst && /bing/i.test(pathKey)
      rows.push({
        name,
        ok: true,
        ms,
        status,
        items,
        extract_path: pathKey,
        expectSeedFirst,
        bing_extract_violation: bingViolation,
        cloud_scrape_calls: Number(meta.cloud_scrape_calls || 0),
        urls_fetched: Number(meta.urls_fetched || meta.channel_trace?.length || 0),
        meta,
      })
      console.log(`  OK  ${name} ${ms}ms path=${pathKey} items=${items}${bingViolation ? ' [BING-DUP]' : ''}`)
    } catch (e) {
      rows.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.message || e), expectSeedFirst })
      console.log(`  FAIL ${name} ${String(e?.message || e)}`)
    }
    await sleep(300)
  }

  const acceptance = buildAcceptance(rows, stats)
  const report = { at: new Date().toISOString(), wsUrl, stats, acceptance, rows }
  const outDir = path.join(process.cwd(), '.data')
  await fs.mkdir(outDir, { recursive: true })
  const outFile = path.join(outDir, 'extractor-eval-report.json')
  await fs.writeFile(outFile, JSON.stringify(report, null, 2), 'utf8')
  console.log(`eval report -> ${outFile}`)
  console.log('acceptance:', JSON.stringify(acceptance, null, 2))

  if (writeBaseline) {
    const baseline = {
      version: 1,
      recorded_at: report.at,
      acceptance: {
        ...acceptance,
        targets: acceptance.targets,
      },
    }
    await fs.writeFile(BASELINE_FILE, JSON.stringify(baseline, null, 2), 'utf8')
    console.log(`baseline written -> ${BASELINE_FILE}`)
  }

  let exitCode = rows.some((r) => !r.ok) ? 1 : 0
  if (compareBaseline) {
    try {
      const raw = await fs.readFile(BASELINE_FILE, 'utf8')
      const baseline = parseJson(raw)
      const violations = gateAcceptance(acceptance, baseline?.acceptance)
      if (violations.length) {
        console.log('baseline gate FAIL:')
        for (const v of violations) console.log(`  - ${v}`)
        exitCode = 1
      } else {
        console.log('baseline gate PASS')
      }
    } catch (e) {
      console.log(`baseline compare skipped: ${String(e?.message || e)}`)
    }
  }

  process.exit(exitCode)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
