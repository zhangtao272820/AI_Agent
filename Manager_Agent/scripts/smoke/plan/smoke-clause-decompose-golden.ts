/**
 * P2-6：子句拆解黄金集结构校验（不调用 LLM）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  agentsFromClauses,
  buildAgentScopedQuery,
  clausesFromMeta,
  reconcileRouteAllowedAgents
} from '../../../server/graph/core/routing/clauses'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../../..')
const FILE = path.join(root, 'eval', 'golden-clause-decompose.json')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function includesAny(text, parts) {
  const t = String(text || '')
  for (const p of parts || []) {
    if (t.includes(String(p))) return true
  }
  return false
}

const spec = JSON.parse(await fs.readFile(FILE, 'utf8'))
const cases = Array.isArray(spec?.cases) ? spec.cases : []
assert(cases.length > 0, 'no clause cases')

const prevDecompose = process.env.MANAGER_CLAUSE_DECOMPOSE
process.env.MANAGER_CLAUSE_DECOMPOSE = '1'

for (const c of cases) {
  const clauses = clausesFromMeta({ taskClauses: c.taskClauses })
  assert(clauses.length === c.taskClauses.length, `${c.id}: clause count`)
  const agents = agentsFromClauses(clauses)
  for (const a of c.expectAgents || []) {
    assert(agents.includes(a), `${c.id}: missing agent ${a}`)
  }
  if (c.expectScopedRagIncludes) {
    const scoped = buildAgentScopedQuery('rag', clauses, c.user)
    assert(includesAny(scoped, c.expectScopedRagIncludes), `${c.id}: scoped rag query`)
  }
  if (c.expectScopedDbIncludes) {
    const scoped = buildAgentScopedQuery('db', clauses, c.user)
    assert(includesAny(scoped, c.expectScopedDbIncludes), `${c.id}: scoped db query`)
  }
  if (c.expectRouteMerge) {
    const hint = c.expectRouteMerge.routerHint || []
    const merged = reconcileRouteAllowedAgents(hint, clauses)
    for (const a of c.expectRouteMerge.mustInclude || []) {
      assert(merged.includes(a), `${c.id}: route merge missing ${a}`)
    }
  }
  console.log(`clause golden ok: ${c.id}`)
}

if (prevDecompose === undefined) delete process.env.MANAGER_CLAUSE_DECOMPOSE
else process.env.MANAGER_CLAUSE_DECOMPOSE = prevDecompose

console.log('smoke: clause-decompose golden ok')
