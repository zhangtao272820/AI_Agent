/**
 * D-P1-3 SQL 路径收敛 smoke：Playbook prompt + guard pipeline SSOT。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  sqlDirectSystemPrompt,
  sqlPlanDirectSystemPrompt,
  sqlPreflightSystemPrompt,
  sqlRepairSystemPrompt,
  validateGeneratedSelectSql,
  prepareSelectForExecution,
} from '../utils/sql/index.ts'
import { defaultQueryPlan } from '../utils/nlu/query_plan.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const root = dirname(fileURLToPath(import.meta.url))

const preflight = sqlPreflightSystemPrompt()
assert(preflight.includes('JSON'), 'preflight prompt loaded')
assert(preflight.includes('must_filters'), 'preflight mentions must_filters')

const direct = sqlDirectSystemPrompt()
assert(direct.includes('SELECT'), 'direct prompt loaded')
assert(direct.includes('LIMIT'), 'direct mentions limit')

const planDirect = sqlPlanDirectSystemPrompt()
assert(planDirect.includes('clarify'), 'planDirect prompt loaded')

const repair = sqlRepairSystemPrompt()
assert(repair.includes('MySQL') || repair.includes('修复'), 'repair prompt loaded')

const plan = {
  ...defaultQueryPlan(),
  confidence: 0.85,
  entities: { names: ['张三'], locations: [], orgs: [], ids: [] },
  filters: {
    time_range: { start: '', end: '', relative: '' },
    where: [],
    slots: [],
  },
}

const bad = validateGeneratedSelectSql('DELETE FROM person_info', { queryPlan: plan })
assert(!bad.ok && bad.stage === 'readonly', 'rejects non-select')

const missingName = validateGeneratedSelectSql('SELECT COUNT(*) FROM person_info', {
  queryPlan: plan,
  preflight: { refined_question: '张三', schema_search_keywords: '张三', sql_intent_summary: '', must_filters: ['张三'], risk_notes: [] },
})
assert(!missingName.ok && missingName.stage === 'plan_guard', 'plan guard catches missing name')

const ok = validateGeneratedSelectSql("SELECT * FROM person_info WHERE name LIKE '%张三%'", {
  queryPlan: plan,
  preflight: { refined_question: '张三', schema_search_keywords: '张三', sql_intent_summary: '', must_filters: ['张三'], risk_notes: [] },
})
assert(ok.ok, 'valid select passes guard pipeline')

const prepared = prepareSelectForExecution(ok.ok ? ok.sql : 'SELECT 1', 15)
assert(prepared.includes('LIMIT'), 'prepare adds limit')
assert(prepared.includes('MAX_EXECUTION_TIME'), 'prepare adds timeout hint')

const runSqlDirect = readFileSync(join(root, '../utils/sql/direct/runSqlDirect.ts'), 'utf8')
assert(runSqlDirect.includes('validateGeneratedSelectSql'), 'sql_direct uses guard pipeline')
assert(!runSqlDirect.includes('DIRECT_SYSTEM_INLINE'), 'sql_direct inline prompt removed')

const preflightTs = readFileSync(join(root, '../utils/sql_preflight.ts'), 'utf8')
assert(preflightTs.includes('sqlPreflightSystemPrompt'), 'sql_preflight uses shared prompts')

console.log('smoke-sql-path: OK')
