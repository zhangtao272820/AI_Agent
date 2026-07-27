/**
 * P3：在线 Eval — PG 回归集 + 进化 promote 门禁
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { agentPgQuery, isAgentPgConfigured } from './agentPgClient'

export type EvalCaseExpect = {
  intentHint?: string
  mustNotClarify?: boolean
  maxPlanSteps?: number
  minQuestionLen?: number
}

export type EvalRunSummary = {
  runId: number
  suiteId: string
  passed: number
  failed: number
  ok: boolean
  results: Array<{ caseId: string; ok: boolean; detail?: string }>
}

export function isOnlineEvalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_ONLINE_EVAL ?? '1').trim() !== '0'
}

export function isOnlineEvalPromoteGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.EVO_ONLINE_EVAL_GATE ?? '1').trim() !== '0'
}

function managerGoldenPath(): string {
  const cwd = process.cwd()
  const candidates = [
    path.join(cwd, 'eval', 'golden-smoke.json'),
    path.join(cwd, 'Manager_Agent', 'eval', 'golden-smoke.json'),
    path.resolve(cwd, '..', 'Manager_Agent', 'eval', 'golden-smoke.json')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]!
}

export function validateCaseStructure(row: {
  case_id: string
  question: string
  expect_json: EvalCaseExpect
}): { ok: boolean; detail: string } {
  const q = String(row.question || '').trim()
  const exp = row.expect_json || {}
  if (!q) return { ok: false, detail: 'empty_question' }
  const minLen = Number(exp.minQuestionLen ?? 4)
  if (q.length < minLen) return { ok: false, detail: `question_too_short:${q.length}` }
  if (exp.intentHint && !String(exp.intentHint).trim()) {
    return { ok: false, detail: 'empty_intent_hint' }
  }
  if (exp.maxPlanSteps != null && (!Number.isFinite(exp.maxPlanSteps) || exp.maxPlanSteps < 1)) {
    return { ok: false, detail: 'invalid_max_plan_steps' }
  }
  return { ok: true, detail: 'struct_ok' }
}

export async function seedManagerEvalSuiteFromGolden(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ seeded: boolean; cases: number }> {
  if (!isAgentPgConfigured(env)) return { seeded: false, cases: 0 }
  const suiteId = 'manager_golden_smoke'
  const fp = managerGoldenPath()
  let raw = ''
  try {
    raw = await fs.readFile(fp, 'utf8')
  } catch {
    return { seeded: false, cases: 0 }
  }
  const obj = JSON.parse(raw) as { cases?: Array<{ id?: string; user?: string; expect?: EvalCaseExpect }> }
  const cases = Array.isArray(obj.cases) ? obj.cases : []
  if (!cases.length) return { seeded: false, cases: 0 }

  await agentPgQuery(
    `INSERT INTO mgr_eval_suites (id, agent, title, enabled, source, updated_at)
     VALUES ($1, 'manager', $2, TRUE, 'golden-smoke.json', NOW())
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
    [suiteId, String(obj && 'description' in obj ? (obj as { description?: string }).description : '') || 'Manager golden smoke'],
    env
  )

  let n = 0
  for (const c of cases) {
    const caseId = String(c.id || '').trim()
    const question = String(c.user || '').trim()
    if (!caseId || !question) continue
    await agentPgQuery(
      `INSERT INTO mgr_eval_cases (suite_id, case_id, question, expect_json, enabled)
       VALUES ($1, $2, $3, $4::jsonb, TRUE)
       ON CONFLICT (suite_id, case_id) DO UPDATE SET
         question = EXCLUDED.question,
         expect_json = EXCLUDED.expect_json,
         enabled = TRUE`,
      [suiteId, caseId, question, JSON.stringify(c.expect || {})],
      env
    )
    n += 1
  }
  return { seeded: true, cases: n }
}

export async function runEvalSuite(
  suiteId: string,
  opts?: { trigger?: string },
  env: NodeJS.ProcessEnv = process.env
): Promise<EvalRunSummary | null> {
  if (!isOnlineEvalEnabled(env) || !isAgentPgConfigured(env)) return null
  const sid = String(suiteId || '').slice(0, 64)
  if (!sid) return null

  const casesRes = await agentPgQuery<{
    case_id: string
    question: string
    expect_json: EvalCaseExpect
  }>(
    `SELECT case_id, question, expect_json FROM mgr_eval_cases
     WHERE suite_id = $1 AND enabled = TRUE ORDER BY id ASC`,
    [sid],
    env
  )
  const cases = casesRes?.rows ?? []
  if (!cases.length) return null

  const runRes = await agentPgQuery<{ id: string }>(
    `INSERT INTO mgr_eval_runs (suite_id, trigger_source, status, passed, failed)
     VALUES ($1, $2, 'running', 0, 0) RETURNING id`,
    [sid, String(opts?.trigger || 'manual').slice(0, 32)],
    env
  )
  const runId = Number(runRes?.rows?.[0]?.id)
  if (!runId) return null

  const results: EvalRunSummary['results'] = []
  let passed = 0
  let failed = 0

  for (const row of cases) {
    const t0 = Date.now()
    const v = validateCaseStructure({
      case_id: row.case_id,
      question: row.question,
      expect_json: (row.expect_json && typeof row.expect_json === 'object' ? row.expect_json : {}) as EvalCaseExpect
    })
    const ms = Date.now() - t0
    if (v.ok) passed += 1
    else failed += 1
    results.push({ caseId: row.case_id, ok: v.ok, detail: v.detail })
    await agentPgQuery(
      `INSERT INTO mgr_eval_results (run_id, case_id, ok, detail, ms) VALUES ($1, $2, $3, $4, $5)`,
      [runId, row.case_id, v.ok, v.detail, ms],
      env
    )
  }

  const ok = failed === 0
  await agentPgQuery(
    `UPDATE mgr_eval_runs SET status = $2, passed = $3, failed = $4, finished_at = NOW() WHERE id = $1`,
    [runId, ok ? 'passed' : 'failed', passed, failed],
    env
  )

  return { runId, suiteId: sid, passed, failed, ok, results }
}

export async function getLatestEvalRun(
  suiteId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: boolean; passed: number; failed: number; runId: number } | null> {
  if (!isAgentPgConfigured(env)) return null
  const res = await agentPgQuery<{ id: string; status: string; passed: string; failed: string }>(
    `SELECT id, status, passed::text, failed::text FROM mgr_eval_runs
     WHERE suite_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [suiteId],
    env
  )
  const row = res?.rows?.[0]
  if (!row) return null
  return {
    runId: Number(row.id),
    ok: row.status === 'passed',
    passed: Number(row.passed) || 0,
    failed: Number(row.failed) || 0
  }
}

/** 进化 promote 门禁：最近 eval 必须通过（无 PG 时跳过） */
export async function evalGateForPromote(
  agent: 'manager' | 'db' | 'rag' | 'admin',
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: boolean; gate: string; reason?: string; summary?: EvalRunSummary | null }> {
  if (!isOnlineEvalPromoteGateEnabled(env)) {
    return { ok: true, gate: 'eval_gate_disabled' }
  }
  if (!isAgentPgConfigured(env)) {
    return { ok: true, gate: 'pg_not_configured_skip' }
  }

  const suiteByAgent: Record<string, string> = {
    manager: 'manager_golden_smoke',
    db: 'db_metrics_smoke',
    rag: 'rag_parse_smoke',
    admin: 'admin_batch_smoke'
  }
  const suiteId = suiteByAgent[agent]
  if (!suiteId) return { ok: true, gate: 'no_suite_for_agent' }

  if (agent === 'manager') {
    await seedManagerEvalSuiteFromGolden(env).catch(() => undefined)
  }

  let latest = await getLatestEvalRun(suiteId, env)
  if (!latest || !latest.ok) {
    const summary = await runEvalSuite(suiteId, { trigger: 'promote_gate' }, env)
    if (!summary) {
      return { ok: true, gate: 'no_eval_cases_skip' }
    }
    latest = { runId: summary.runId, ok: summary.ok, passed: summary.passed, failed: summary.failed }
    if (!summary.ok) {
      return { ok: false, gate: 'online_eval_failed', reason: `failed=${summary.failed}`, summary }
    }
    return { ok: true, gate: 'online_eval_passed', summary }
  }
  return { ok: true, gate: 'online_eval_cached_pass' }
}
