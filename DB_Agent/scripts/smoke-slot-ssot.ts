/**
 * CF-3 Slot SSOT + Plan Completeness smoke：
 * - 结构门槛：过滤槽完备可跳过；稀疏 stub 不可跳过
 * - 语义完备由 LLM 门裁决（本 smoke 断言模块接线，不跑模型）
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assemblePlanSlotsOrNull,
  queryPlanReadyToSkipSlotLlm,
} from '../utils/nlu/assemble_plan_slots.ts'
import { conservativePlanCompletenessFallback } from '../utils/nlu/dbPlanCompletenessLlm.ts'
import type { QueryPlan } from '../utils/nlu/query_plan.ts'
import { defaultQueryPlan } from '../utils/nlu/query_plan.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const root = dirname(fileURLToPath(import.meta.url))

function resolveManagerAssembledQueryPlan(mgr: {
  source?: string
  query_plan_json?: string
}): QueryPlan | null {
  if (mgr?.source !== 'manager') return null
  const raw = String(mgr.query_plan_json ?? '').trim()
  if (!raw) return null
  return assemblePlanSlotsOrNull(JSON.parse(raw) as QueryPlan)
}

function shouldUseManagerAssembledQueryPlan(mgr: {
  source?: string
  query_plan_json?: string
}): boolean {
  const plan = resolveManagerAssembledQueryPlan(mgr)
  return plan != null && queryPlanReadyToSkipSlotLlm(plan)
}

const completeMgr = {
  source: 'manager',
  query_plan_json: JSON.stringify({
    ...defaultQueryPlan(),
    intent: 'aggregation',
    subject: 'person',
    data_domain: 'person_basic',
    confidence: 0.82,
    entities: { locations: ['河西区'], names: [], orgs: [], ids: [] },
    metrics: ['人数'],
    filters: {
      time_range: { start: '', end: '', relative: '' },
      where: [],
      slots: [{ field_hint: 'region', value: '河西区', sql_match_value: '河西区' }],
    },
  }),
}
assert(resolveManagerAssembledQueryPlan(completeMgr) !== null, 'assembled manager plan accepted')
assert(shouldUseManagerAssembledQueryPlan(completeMgr) === true, 'complete plan may skip slot LLM')
assert(
  queryPlanReadyToSkipSlotLlm(resolveManagerAssembledQueryPlan(completeMgr)) === true,
  'complete plan with region slot ready',
)

const locationsOnly = {
  ...defaultQueryPlan(),
  intent: 'aggregation' as const,
  subject: 'person' as const,
  data_domain: 'person_basic' as const,
  confidence: 0.8,
  entities: { locations: ['河西区'], names: [], orgs: [], ids: [] },
  metrics: ['人数'],
}
assert(
  queryPlanReadyToSkipSlotLlm(locationsOnly) === false,
  'person aggregation with only entities.locations must still run Slot LLM',
)

const dirty = {
  source: 'manager',
  query_plan_json: JSON.stringify({
    ...defaultQueryPlan(),
    intent: 'aggregation',
    confidence: 0.82,
    entities: { locations: ['查询河西区'], names: [], orgs: [], ids: [] },
    metrics: ['人数'],
  }),
}
assert(resolveManagerAssembledQueryPlan(dirty) === null, 'dirty location rejected')

const sparseStub = {
  source: 'manager',
  query_plan_json: JSON.stringify({
    ...defaultQueryPlan(),
    intent: 'aggregation',
    subject: 'person',
    data_domain: 'person_basic',
    confidence: 0.7,
    entities: { locations: [], names: [], orgs: [], ids: [] },
    metrics: ['人数'],
    dimensions: [],
    filters: { time_range: { start: '', end: '', relative: '' }, where: [], slots: [] },
  }),
}
assert(resolveManagerAssembledQueryPlan(sparseStub) !== null, 'sparse stub still assembles')
assert(
  shouldUseManagerAssembledQueryPlan(sparseStub) === false,
  'sparse stub must NOT skip slot LLM via manager gate',
)
assert(
  queryPlanReadyToSkipSlotLlm(resolveManagerAssembledQueryPlan(sparseStub)!) === false,
  'sparse stub not ready to skip',
)

const genderDistReady = {
  ...defaultQueryPlan(),
  intent: 'aggregation' as const,
  subject: 'person' as const,
  data_domain: 'person_basic' as const,
  confidence: 0.85,
  entities: { locations: ['河西区'], names: [], orgs: [], ids: [] },
  metrics: ['性别分布'],
  dimensions: ['性别'],
  filters: {
    time_range: { start: '', end: '', relative: '' },
    where: [],
    slots: [
      { field_hint: 'region', value: '河西区', sql_match_value: '河西区' },
      { field_hint: 'age_gte', value: '70', sql_match_value: '70' },
      { field_hint: 'age_lte', value: '79', sql_match_value: '79' },
    ],
  },
}
assert(queryPlanReadyToSkipSlotLlm(genderDistReady) === true, 'gender dist with filters structurally ready')

const genderDistSparse = {
  ...defaultQueryPlan(),
  intent: 'aggregation' as const,
  subject: 'person' as const,
  data_domain: 'person_basic' as const,
  confidence: 0.7,
  metrics: ['性别分布'],
  dimensions: ['性别'],
}
assert(queryPlanReadyToSkipSlotLlm(genderDistSparse) === false, 'dimensions without filters not ready')

// 保守 fallback：稀疏 plan 不得跳过 Stage-2 / 不得开 person 快路径；槽齐则可开快路径
const fb = conservativePlanCompletenessFallback(genderDistSparse)
assert(fb.ready_to_skip_slot_llm === false, 'fallback never skips slot')
assert(fb.needs_schema_refine === true, 'fallback needs refine')
assert(fb.allow_person_fast_path === false, 'fallback denies person fast path when sparse')
assert(fb.source === 'structural', 'fallback source structural')
const fbReady = conservativePlanCompletenessFallback(genderDistReady)
assert(fbReady.allow_person_fast_path === true, 'fallback allows fast path when region/age slots ready')
assert(fbReady.ready_to_skip_slot_llm === false, 'fallback still forces slot path until LLM says skip')

assert(existsSync(join(root, '../utils/nlu/dbPlanCompletenessLlm.ts')), 'completeness llm module present')

const assembleSrc = readFileSync(join(root, '../utils/nlu/assemble_plan_slots.ts'), 'utf8')
assert(!assembleSrc.includes('planImpliesElderPopulation'), 'elder hardcode helper removed')
assert(!assembleSrc.includes('/老年人|老人/'), 'assemble no elder population regex')
assert(!/includes\([`'"]性别[`'"]\)/.test(assembleSrc), 'assemble ready gate no gender keyword')

const decompose = readFileSync(join(root, '../utils/nlu/dbQueryDecompose.ts'), 'utf8')
assert(decompose.includes('resolvePlanCompleteness'), 'decompose uses completeness LLM')
assert(decompose.includes('mergeImpliedFiltersIntoPlan'), 'decompose merges implied filters')
assert(!decompose.includes('monoBlob.includes'), 'decompose has no gender blob keyword retry')
assert(decompose.includes('slotSource: "manager"'), 'decompose still short-circuits when ready')

const router = readFileSync(join(root, '../utils/nlu/dbModelRouter.ts'), 'utf8')
assert(router.includes('completeness'), 'router refine gated by completeness')
assert(!router.includes('blob.includes("老人")'), 'router no elder keyword')

const nluMode = readFileSync(join(root, '../utils/db_nlu_mode.ts'), 'utf8')
assert(nluMode.includes('plan_completeness'), 'nlu flag plan_completeness registered')

const mgrCtx = readFileSync(join(root, '../utils/manager_task_context.ts'), 'utf8')
assert(mgrCtx.includes('queryPlanReadyToSkipSlotLlm'), 'manager gate uses readiness')

const chain = readFileSync(join(root, '../utils/conversational_retrieval_chain.ts'), 'utf8')
const createDbGraph = readFileSync(join(root, '../utils/graph/createDbGraph.ts'), 'utf8')
const planNode = readFileSync(join(root, '../utils/graph/nodes/plan.ts'), 'utf8')
const routeNode = readFileSync(join(root, '../utils/graph/nodes/route.ts'), 'utf8')
const schemaGround = readFileSync(join(root, '../utils/graph/nodes/schemaGround.ts'), 'utf8')
assert(
  chain.includes('createDbGraph') && createDbGraph.includes('createPlanNode'),
  'chain wires graph via createDbGraph factory',
)
assert(
  planNode.includes('exportQueryPlanForState') && planNode.includes('assemblePlanSlotsOrNull'),
  'plan node uses slot SSOT export',
)
assert(planNode.includes('plan_completeness_json'), 'plan node writes completeness')
assert(schemaGround.includes('resolvePlanCompleteness'), 'schemaGround runs completeness')
assert(
  (schemaGround.match(/resolvePlanCompleteness/g) || []).length >= 2,
  'schemaGround recomputes completeness after refine',
)
assert(
  planNode.includes('finalShape !== "distribution"') || planNode.includes("finalShape !== 'distribution'"),
  'plan node preserves distribution against structural scalar overwrite',
)
assert(
  planNode.includes('shouldUseManagerAssembledQueryPlan') || routeNode.includes('buildRouteDecision'),
  'graph nodes retain manager/route logic',
)

const adminLlm = readFileSync(
  join(root, '../../AI_admin_Agent/backend/app/core/admin_manager_plan_llm.py'),
  'utf8',
)
assert(adminLlm.includes('_manager_orchestrated_needs_slot_llm'), 'admin slot skip gate present')

console.log('smoke-slot-ssot: OK')
