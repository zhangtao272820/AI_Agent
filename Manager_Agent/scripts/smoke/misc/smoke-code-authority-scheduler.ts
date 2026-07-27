/**
 * Code 权威 + 调度门禁回归（纯函数）。
 */
import { applyRoutePlanCoverage } from '../../../server/graph/core/plan'
import { isStepReadyForExecution } from '../../../server/graph/core/plan/planParallel'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const covered = applyRoutePlanCoverage(
  [
    { id: 'step_rag', agent: 'rag', query: 'q' },
    { id: 'step_code', agent: 'code', query: 'c' }
  ],
  { question: 'x', intent: 'multi', allowedCap: ['rag', 'code', 'visualize'] }
)
const viz = covered.find((s) => s.agent === 'visualize')
assert(viz?.dependsOn?.includes('step_code'), 'coverage-added visualize must depend on code')

const finPlan = [
  { id: 's1', agent: 'rag', query: 'q' },
  { id: 's2', agent: 'code', query: 'c', dependsOn: ['s1'] },
  { id: 's6', agent: 'report', query: 'r', dependsOn: ['s2'] }
] as const
assert(!isStepReadyForExecution(finPlan[2]!, [...finPlan], {}), 'report blocked before code')
assert(
  isStepReadyForExecution(finPlan[2]!, [...finPlan], { s2: { status: 'ok' } }),
  'report ready after code ok'
)
assert(
  !isStepReadyForExecution({ id: 's5', agent: 'visualize', query: 'v' }, finPlan, {}),
  'visualize without dependsOn blocked when plan has code'
)

console.log('smoke: code authority scheduler ok')
