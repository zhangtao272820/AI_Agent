/**
 * D-P1-4 + D-P2-1 smoke：DB_NLU_MODE preset 与 structural plan 无 LOCATION_RE。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isDbNluFeatureEnabled,
  resolveDbNluMode,
  summarizeDbNluFeatures,
} from '../utils/db_nlu_mode.ts'
import { inferQueryPlanStructural } from '../utils/nlu/structural_query_plan.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const root = dirname(fileURLToPath(import.meta.url))

assert(resolveDbNluMode({ DB_NLU_MODE: 'full' }) === 'full', 'full mode')
assert(resolveDbNluMode({ DB_NLU_MODE: 'minimal' }) === 'minimal', 'minimal mode')
assert(resolveDbNluMode({ DB_NLU_MODE: 'off' }) === 'off', 'off mode')

const offEnv = { DB_NLU_MODE: 'off' } as NodeJS.ProcessEnv
assert(!isDbNluFeatureEnabled('decompose', offEnv), 'off disables decompose')
assert(!isDbNluFeatureEnabled('schema_link', offEnv), 'off disables schema_link')

const minEnv = { DB_NLU_MODE: 'minimal' } as NodeJS.ProcessEnv
assert(isDbNluFeatureEnabled('intent', minEnv), 'minimal keeps intent')
assert(!isDbNluFeatureEnabled('decompose', minEnv), 'minimal disables decompose')
assert(isDbNluFeatureEnabled('schema_link', minEnv), 'minimal keeps schema_link')

const overrideEnv = { DB_NLU_MODE: 'off', DB_SCHEMA_LINK_LLM: '1' } as NodeJS.ProcessEnv
assert(isDbNluFeatureEnabled('schema_link', overrideEnv), 'explicit env overrides preset')

const summary = summarizeDbNluFeatures({ DB_NLU_MODE: 'minimal' } as NodeJS.ProcessEnv)
assert(summary.intent === true && summary.entity === false, 'summarize reflects minimal')

const structural = readFileSync(join(root, '../utils/nlu/structural_query_plan.ts'), 'utf8')
assert(!/LOCATION_RE\s*=/.test(structural), 'LOCATION_RE regex assignment removed')

const regionPlan = inferQueryPlanStructural('河西区老人人数')
assert(
  (regionPlan.entities.locations?.length ?? 0) === 0,
  'structural plan must not regex-extract region',
)
assert(regionPlan.intent === 'aggregation' || regionPlan.subject === 'person', 'elder/stat intent still works')

const elderOnly = inferQueryPlanStructural('老人人数')
assert(elderOnly.subject === 'person', 'elder marker sets person subject without region')

console.log('smoke-db-nlu-mode: OK')
