/**
 * 校验 Manager eval 黄金用例 JSON（CI 门禁，不发起真实 LLM 调用）。
 * 用法：node scripts/check-eval-golden-all.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const evalDir = path.join(root, 'eval')

const FILES = ['golden-smoke.json', 'golden-web-search.json', 'golden-multi-latency.json']
const ROUTE_FILES = ['golden-gui-route.json', 'golden-route-media.json']
const E2E_FILE = 'golden-e2e-paths.json'
const CLAUSE_FILE = 'golden-clause-decompose.json'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function validateCase(c, file) {
  assert(c && typeof c === 'object', `${file}: case must be object`)
  assert(String(c.id || '').trim(), `${file}: case.id required`)
  assert(String(c.user || '').trim(), `${file}: case.user required for ${c.id}`)
  assert(c.expect && typeof c.expect === 'object', `${file}: case.expect required for ${c.id}`)
  const ex = c.expect
  if (ex.phases != null) {
    assert(Array.isArray(ex.phases), `${file}:${c.id} expect.phases must be array`)
  }
  if (ex.maxDurationMs != null) {
    assert(Number(ex.maxDurationMs) > 0, `${file}:${c.id} maxDurationMs must be positive`)
  }
  if (ex.maxPlanSteps != null) {
    assert(Number(ex.maxPlanSteps) >= 1, `${file}:${c.id} maxPlanSteps must be >= 1`)
  }
}

function validateRouteCase(c, file) {
  assert(c && typeof c === 'object', `${file}: case must be object`)
  assert(String(c.id || '').trim(), `${file}: case.id required`)
  assert(String(c.query || '').trim(), `${file}: case.query required for ${c.id}`)
  assert(String(c.expectIntent || '').trim(), `${file}: case.expectIntent required for ${c.id}`)
  if (c.expectAllowedIncludes != null) {
    assert(Array.isArray(c.expectAllowedIncludes), `${file}:${c.id} expectAllowedIncludes must be array`)
  }
  if (c.expectAllowedExcludes != null) {
    assert(Array.isArray(c.expectAllowedExcludes), `${file}:${c.id} expectAllowedExcludes must be array`)
  }
}

async function validateRouteFile(name) {
  const p = path.join(evalDir, name)
  const raw = await fs.readFile(p, 'utf8').catch(() => '')
  assert(raw.trim(), `missing file: ${p}`)
  let obj
  try {
    obj = JSON.parse(raw)
  } catch (e) {
    throw new Error(`${name}: invalid JSON — ${e?.message || e}`)
  }
  assert(obj && typeof obj === 'object', `${name}: root must be object`)
  assert(Array.isArray(obj.cases) && obj.cases.length >= 1, `${name}: cases must be non-empty array`)
  for (const c of obj.cases) validateRouteCase(c, name)
  return obj.cases.length
}

function validateE2eCase(c, file) {
  assert(c && typeof c === 'object', `${file}: case must be object`)
  assert(String(c.id || '').trim(), `${file}: case.id required`)
  assert(String(c.text || '').trim(), `${file}: case.text required for ${c.id}`)
  assert(c.expect && typeof c.expect === 'object', `${file}: case.expect required for ${c.id}`)
}

function validateClauseGoldenCase(c, file) {
  assert(c && typeof c === 'object', `${file}: case must be object`)
  assert(String(c.id || '').trim(), `${file}: case.id required`)
  assert(String(c.user || '').trim(), `${file}: case.user required for ${c.id}`)
  assert(Array.isArray(c.taskClauses) && c.taskClauses.length >= 1, `${file}:${c.id} taskClauses required`)
  assert(Array.isArray(c.expectAgents) && c.expectAgents.length >= 1, `${file}:${c.id} expectAgents required`)
}

async function validateE2eFile(name) {
  const p = path.join(evalDir, name)
  const raw = await fs.readFile(p, 'utf8').catch(() => '')
  assert(raw.trim(), `missing file: ${p}`)
  const obj = JSON.parse(raw)
  assert(obj && typeof obj === 'object', `${name}: root must be object`)
  assert(Array.isArray(obj.cases) && obj.cases.length >= 1, `${name}: cases must be non-empty array`)
  for (const c of obj.cases) validateE2eCase(c, name)
  return obj.cases.length
}

async function validateClauseFile(name) {
  const p = path.join(evalDir, name)
  const raw = await fs.readFile(p, 'utf8').catch(() => '')
  assert(raw.trim(), `missing file: ${p}`)
  const obj = JSON.parse(raw)
  assert(obj && typeof obj === 'object', `${name}: root must be object`)
  assert(Array.isArray(obj.cases) && obj.cases.length >= 1, `${name}: cases must be non-empty array`)
  for (const c of obj.cases) validateClauseGoldenCase(c, name)
  return obj.cases.length
}

async function validateFile(name) {
  const p = path.join(evalDir, name)
  const raw = await fs.readFile(p, 'utf8').catch(() => '')
  assert(raw.trim(), `missing file: ${p}`)
  let obj
  try {
    obj = JSON.parse(raw)
  } catch (e) {
    throw new Error(`${name}: invalid JSON — ${e?.message || e}`)
  }
  assert(obj && typeof obj === 'object', `${name}: root must be object`)
  assert(Array.isArray(obj.cases) && obj.cases.length >= 1, `${name}: cases must be non-empty array`)
  for (const c of obj.cases) validateCase(c, name)
  return obj.cases.length
}

let total = 0
for (const f of FILES) {
  const n = await validateFile(f)
  console.log(`${f} OK: ${n} cases`)
  total += n
}
for (const f of ROUTE_FILES) {
  const n = await validateRouteFile(f)
  console.log(`${f} OK: ${n} route cases`)
  total += n
}
const e2eN = await validateE2eFile(E2E_FILE)
console.log(`${E2E_FILE} OK: ${e2eN} e2e cases`)
total += e2eN
const clauseN = await validateClauseFile(CLAUSE_FILE)
console.log(`${CLAUSE_FILE} OK: ${clauseN} clause cases`)
total += clauseN
console.log(`eval:golden:all OK — ${total} cases across ${FILES.length + ROUTE_FILES.length + 2} files`)
