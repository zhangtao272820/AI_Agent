/**
 * A5：局部 replan 超阈 → 强制回退 Plan（确定性）
 */
import {
  shouldForcePlanRollback,
  shouldConsiderLocalReplan,
  localReplanMaxPerRun
} from '../../../server/graph/core/plan/localReplan'
import { assessVerifierCompletion } from '../../../server/graph/core/output/verifierCompletion'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

assert(shouldConsiderLocalReplan({ status: 'failed' }), 'failed considers replan')
assert(!shouldForcePlanRollback({ localReplanCount: 0, maxLocalReplans: 3, wouldConsiderReplan: true }), 'under threshold')
assert(
  !shouldForcePlanRollback({ localReplanCount: 2, maxLocalReplans: 3, wouldConsiderReplan: true }),
  '2 < 3 no force'
)
assert(
  shouldForcePlanRollback({ localReplanCount: 3, maxLocalReplans: 3, wouldConsiderReplan: true }),
  'at threshold force'
)
assert(
  shouldForcePlanRollback({ localReplanCount: 5, maxLocalReplans: 3, wouldConsiderReplan: true }),
  'over threshold force'
)
assert(
  !shouldForcePlanRollback({ localReplanCount: 99, maxLocalReplans: 3, wouldConsiderReplan: false }),
  'no replan need → no force'
)

const max = localReplanMaxPerRun()
assert(max >= 0 && max <= 5, 'max bounded')

const v = assessVerifierCompletion({
  intent: 'multi',
  plan: [
    { id: 'a', agent: 'db' },
    { id: 'b', agent: 'rag' }
  ],
  stepRecords: [
    { id: 'a', agent: 'db', status: 'ok' },
    { id: 'b', agent: 'rag', status: 'skipped', error: 'plan_rollback:cancelled' }
  ],
  meta: { forcePlanRollback: true }
})
assert(v?.outcome === 'needs_human', 'cancelled rollback → needs_human')
assert(v?.verdict === 'goal_uncovered', 'cancelled rollback → goal_uncovered')

console.log('smoke-plan-rollback-threshold: ok')
