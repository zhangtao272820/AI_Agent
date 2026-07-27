/**
 * 长任务分 phase：maxRunPhases / phaseStepBudget 回归（不拉 LLM）。
 */
import { maxRunPhases, phaseStepBudget } from '../../../server/graph/core/plan/phaseContinue'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

assert(maxRunPhases() >= 1 && maxRunPhases() <= 6, 'max phases bounded')
assert(phaseStepBudget() >= 1 && phaseStepBudget() <= 8, 'phase budget <= 8')

const prev = process.env.MANAGER_MAX_RUN_PHASES
process.env.MANAGER_MAX_RUN_PHASES = '99'
assert(maxRunPhases() === 6, 'max phases capped at 6')
process.env.MANAGER_MAX_RUN_PHASES = '2'
assert(maxRunPhases() === 2, 'max phases respects env')
if (prev === undefined) delete process.env.MANAGER_MAX_RUN_PHASES
else process.env.MANAGER_MAX_RUN_PHASES = prev

process.env.MANAGER_PHASE_STEP_BUDGET = '99'
assert(phaseStepBudget() === 8, 'budget capped at 8')
delete process.env.MANAGER_PHASE_STEP_BUDGET

console.log('smoke-task-phases: ok')
