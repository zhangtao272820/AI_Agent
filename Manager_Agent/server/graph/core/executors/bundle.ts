import type { ManagerGraphState } from '../../state/state'
import type { Step } from '../../../utils/shared/taskPlan'
import { buildActionExecEffectiveQuery } from '../stepIsolation'
import { resolveAdminAutoConfirm } from '../db/writeGate'
import type { AgentExecutorDeps, AgentExecutorOpts } from './types'

export function buildAgentExecutorBundle(deps: AgentExecutorDeps, opts: AgentExecutorOpts) {
  return { deps, opts }
}

export function buildMultiStepEffQuery(
  step: Step,
  question: string,
  ctx: string,
  state: ManagerGraphState
): string {
  return buildActionExecEffectiveQuery(
    step,
    question,
    ctx,
    resolveAdminAutoConfirm(state, String(step.query || question || '')),
    (state.meta as Record<string, unknown> | undefined) ?? null
  )
}

