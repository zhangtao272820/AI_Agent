/**
 * 局部 Replan / taskFetcher patch 回归：不拉 LLM。
 */
import {
  shouldConsiderLocalReplan,
  applyRemainingStepsPatch,
  localReplanMaxPerRun,
  shouldForcePlanRollback,
  filterStepsExcludingCircuitAgents,
  resolveCircuitBlockedReplan
} from '../../../server/graph/core/plan/localReplan'
import { applyStepCompletePatch } from '../../../server/graph/core/task/taskFetcher'
import type { Step } from '../../../server/utils/shared/taskPlan'
import type { StepCompletionRecord } from '../../../server/graph/core/plan/planParallel'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

assert(shouldConsiderLocalReplan({ status: 'failed', output: 'x' }), 'failed should replan')
assert(shouldConsiderLocalReplan({ status: 'ok', output: '', error: 'timeout' }), 'error should replan')
assert(shouldConsiderLocalReplan({ status: 'ok', output: '短' }), 'short output should replan')
assert(!shouldConsiderLocalReplan({ status: 'ok', output: '这是一段足够长的可用结果摘要内容' }), 'good output skip')

assert(localReplanMaxPerRun() >= 0 && localReplanMaxPerRun() <= 5, 'replan max bounded')

assert(
  shouldForcePlanRollback({ localReplanCount: 3, maxLocalReplans: 3, wouldConsiderReplan: true }),
  'threshold forces plan rollback'
)
assert(
  !shouldForcePlanRollback({ localReplanCount: 1, maxLocalReplans: 3, wouldConsiderReplan: true }),
  'under threshold no force'
)

const steps: Step[] = [
  { id: 's1', agent: 'db', query: 'a' },
  { id: 's2', agent: 'rag', query: 'b' },
  { id: 's3', agent: 'report', query: 'c', dependsOn: ['s1', 's2'] }
]
const pending = new Map(steps.map((s) => [String(s.id), s]))
pending.delete('s1')
const completed = new Set(['s1'])
const next = applyRemainingStepsPatch(
  steps,
  pending,
  [
    { id: 's2b', agent: 'rag', query: '改写检索' },
    { id: 's3b', agent: 'report', query: '改写报告', dependsOn: ['s1', 's2b'] }
  ],
  completed
)
assert(next.length === 3, 'completed + 2 remaining')
assert(next[0]?.id === 's1', 'completed kept first')
assert(pending.has('s2b') && pending.has('s3b'), 'pending updated')
assert(!pending.has('s2'), 'old pending removed')

const steps2: Step[] = [
  { id: 'a', agent: 'db', query: '1' },
  { id: 'b', agent: 'rag', query: '2' }
]
const pending2 = new Map(steps2.map((s) => [String(s.id), s]))
pending2.delete('a')
const completedById: Record<string, StepCompletionRecord> = {
  a: { status: 'ok' }
}
applyStepCompletePatch(steps2, pending2, completedById, {
  replaceRemaining: [{ id: 'b2', agent: 'crawler', query: '补检索' }]
})
assert(steps2.some((s) => s.id === 'a'), 'completed step remains')
assert(steps2.some((s) => s.id === 'b2'), 'replaced remaining injected')
assert(pending2.has('b2'), 'pending has new step')
assert(!pending2.has('b'), 'old pending gone')

// circuit-open agent 不得出现在过滤后的 remaining
const mixed: Step[] = [
  { id: 'd1', agent: 'db', query: '再查' },
  { id: 'r1', agent: 'rag', query: '检索' },
  { id: 'rep', agent: 'report', query: '报告' }
]
const filtered = filterStepsExcludingCircuitAgents(mixed, ['db'])
assert(filtered.length === 2, 'db stripped')
assert(!filtered.some((s) => s.agent === 'db'), 'no db in remaining')
assert(filtered.some((s) => s.agent === 'rag'), 'rag kept')

assert(
  resolveCircuitBlockedReplan({
    failedAgent: 'db',
    pendingSteps: mixed,
    circuitOpenAgents: []
  }).kind === 'passthrough',
  'no circuit → passthrough'
)

const strip = resolveCircuitBlockedReplan({
  failedAgent: 'db',
  pendingSteps: mixed,
  circuitOpenAgents: ['db']
})
assert(strip.kind === 'strip_circuit', 'has other agents → strip')
if (strip.kind === 'strip_circuit') {
  assert(strip.kept.every((s) => s.agent !== 'db'), 'kept excludes db')
  assert(strip.skipped.every((s) => s.agent === 'db'), 'skipped is db')
}

const force = resolveCircuitBlockedReplan({
  failedAgent: 'db',
  pendingSteps: [{ id: 'd2', agent: 'db', query: 'only' }],
  circuitOpenAgents: ['db']
})
assert(force.kind === 'force_plan_rollback', 'only circuit agent → force plan')

console.log('smoke-local-replan: ok')
