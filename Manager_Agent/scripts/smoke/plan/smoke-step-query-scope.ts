/**
 * P0 scoped query golden — stepDispatchDraft / 子句隔离
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAgentScopedQuery } from '../../../server/graph/core/routing/clauses'
import { buildBlueprintFromPuStackDispatch } from '../../../server/graph/llm/planBlueprintLlm'
import { stepDispatchDraftFromMeta } from '../../../server/graph/core/proPuStack'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(__dirname, '../../..', 'eval', 'golden-step-query-scope.json')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function includesAll(text: string, parts: string[]): boolean {
  const t = String(text || '')
  return (parts || []).every((p) => t.includes(String(p)))
}

function excludesAll(text: string, parts: string[]): boolean {
  const t = String(text || '')
  return !(parts || []).some((p) => t.includes(String(p)))
}

const spec = JSON.parse(await fs.readFile(FILE, 'utf8'))
const cases = Array.isArray(spec?.cases) ? spec.cases : []
assert(cases.length > 0, 'no step-query-scope cases')

for (const c of cases) {
  const clauses = (c.taskClauses || []).map((row: { id: string; text: string; agents: string[] }) => ({
    id: String(row.id),
    text: String(row.text),
    agents: row.agents as ('rag' | 'db' | 'admin')[]
  }))
  const user = String(c.user || '')
  const draft = clauses.map((cl: { id: string; text: string; agents: string[] }, i: number) => ({
    agent: cl.agents[0],
    scopedUserLanguage: cl.text,
    clauseIds: [cl.id || `c${i + 1}`]
  }))
  const meta = { stepDispatchDraft: draft, clauseDecomposeMode: 'orchestrator' }
  assert(stepDispatchDraftFromMeta(meta).length >= 2, `${c.id}: draft from meta`)

  const expectScoped = c.expectScoped as Record<string, { includes?: string[]; excludes?: string[] }>
  for (const [agent, rules] of Object.entries(expectScoped || {})) {
    const hit = draft.find((d: { agent: string }) => String(d.agent) === agent)
    let scoped = hit?.scopedUserLanguage || buildAgentScopedQuery(agent as 'rag', clauses, user, meta)
    scoped = String(scoped || '').trim()
    assert(scoped.length >= 4, `${c.id}: ${agent} scoped empty`)
    if (rules.includes?.length) assert(includesAll(scoped, rules.includes), `${c.id}: ${agent} missing includes`)
    if (rules.excludes?.length) assert(excludesAll(scoped, rules.excludes), `${c.id}: ${agent} leaked excludes`)
  }

  const bp = buildBlueprintFromPuStackDispatch({
    allowedAgents: c.expectNoCrawler
      ? ['rag', 'db', 'admin', 'clean', 'code', 'report']
      : ['rag', 'db', 'admin', 'clean', 'code', 'visualize'],
    clauses,
    stepDispatchDraft: draft,
    userTask: user
  })
  assert(bp && bp.steps.length >= 3, `${c.id}: blueprint materialized`)
  for (const st of bp!.steps) {
    const focus = String(st.queryFocus || '')
    assert(focus.length >= 4, `${c.id}: ${st.agent} blueprint focus empty`)
    assert(focus !== user || user.length < 12, `${c.id}: ${st.agent} repeats full user text`)
  }
  if (c.expectNoCrawler) {
    assert(!bp!.steps.some((s) => String(s.agent) === 'crawler'), `${c.id}: blueprint must not include crawler`)
  }
  console.log(`step-query-scope ok: ${c.id}`)
}

console.log('smoke: step-query-scope ok')
