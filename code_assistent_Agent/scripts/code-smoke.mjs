/**
 * Code Agent 冒烟：metrics / learning / feedback / retrieve / plan
 * 用法：先 npm run dev，再 npm run smoke:code
 * CI：npm run smoke:code:ci
 */
import fs from 'node:fs'
import path from 'node:path'

const base = process.env.CODE_SMOKE_URL || 'http://localhost:13103'
const minPassRate = Number(process.env.CODE_SMOKE_MIN_PASS_RATE ?? '0.75')
const ciMode = process.argv.includes('--ci') || process.env.CODE_SMOKE_CI === '1'
const cases = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'data/code-smoke-cases.json'), 'utf8'),
)

const results = []
let ok = 0

for (const c of cases) {
  const t0 = Date.now()
  let data = {}
  let pass = false
  try {
    const res = await fetch(`${base}${c.path}`, {
      method: c.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: c.body ? JSON.stringify(c.body) : undefined,
    })
    data = await res.json().catch(() => ({}))
    pass = Boolean(c.expectOk ? data.ok !== false && res.ok : res.ok)
    if (c.minHits != null) {
      pass = pass && Number(data.hits ?? data.snippets?.length ?? 0) >= c.minHits
    }
    if (c.expectNeedsClarify != null) {
      pass = pass && Boolean(data.needsClarify) === Boolean(c.expectNeedsClarify)
    }
    if (c.expectTaskKind) {
      pass = pass && String(data.task_kind || '') === c.expectTaskKind
    }
  } catch (e) {
    console.error(`ERR [${c.id}]`, e?.message || e)
  }
  if (pass) ok += 1
  results.push({ id: c.id, pass, ms: Date.now() - t0 })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${c.id}] ${c.method} ${c.path}`)
}

const report = {
  at: new Date().toISOString(),
  base,
  total: cases.length,
  passed: ok,
  passRate: cases.length ? ok / cases.length : 0,
  minPassRate,
  ciMode,
  results,
}

const outDir = path.join(process.cwd(), '.data')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'code-smoke-baseline.json')
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')

console.log(`\n${ok}/${cases.length} passed (${Math.round(report.passRate * 100)}%)`)
console.log(`baseline -> ${outFile}`)

if (ciMode && report.passRate < minPassRate) {
  console.error(`CI gate failed: passRate ${report.passRate} < ${minPassRate}`)
  process.exit(1)
}
