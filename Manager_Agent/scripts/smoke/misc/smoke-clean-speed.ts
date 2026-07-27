/**
 * clean 提速：结构层优先 + 计划去重（不调 LLM）。
 */
import { assembleCleanPayloadStructural, serializeCleanPayload, isStructuralCleanSufficient, type SourceSnapshot } from '#agent-shared/cleanPayload'
import { dedupeCleanPlanSteps } from '../../../server/graph/core/plan'
import type { Step } from '../../../server/utils/shared/taskPlan'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const snapshots: SourceSnapshot[] = [
  {
    agent: 'db',
    raw: '{"facts":[{"key":"left_length","value":17.83}]}',
    answer: 'db foot scan',
    facts: [{ key: 'left_length', value: 17.83, sourcePath: 'db.left_length' }]
  },
  {
    agent: 'crawler',
    raw: '{"facts":[{"key":"pressure_avg","value":13.35}]}',
    answer: 'crawler metrics',
    facts: [{ key: 'pressure_avg', value: 13.35, sourcePath: 'crawler.pressure_avg' }]
  }
]

const structural = assembleCleanPayloadStructural(snapshots)
assert(structural && isStructuralCleanSufficient(structural), 'structural clean sufficient for multi-source')
const serialized = serializeCleanPayload(structural!)
assert(serialized.includes('multi_source_structural'), 'serialized clean payload mode')

const dupPlan: Step[] = [
  { id: 's_db', agent: 'db', query: 'db' },
  { id: 's_crawl', agent: 'crawler', query: 'crawl' },
  { id: 's_clean1', agent: 'clean', query: 'clean pre', dependsOn: ['s_db', 's_crawl'] },
  { id: 's_code', agent: 'code', query: 'code', dependsOn: ['s_clean1'] },
  { id: 's_clean2', agent: 'clean', query: 'clean post', dependsOn: ['s_code'] }
]
const deduped = dedupeCleanPlanSteps(dupPlan)
assert(deduped.filter((s) => s.agent === 'clean').length === 1, 'dedupe keeps one clean')
assert(deduped.some((s) => s.id === 's_clean1'), 'keeps pre-code clean')

console.log('smoke-clean-speed ok')
