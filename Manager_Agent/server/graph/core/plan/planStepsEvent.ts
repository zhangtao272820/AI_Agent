import type { Step } from '../../../utils/shared/taskPlan'
import { buildStepStatus } from '../runtime/stepStatus'

export type PlanStepTodoItem = {
  id: string
  agent: string
  query: string
  order: number
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  optional?: boolean
}

type PlanStepsEmitterOpts = {
  sendEvent: (event: { event: string; data?: unknown; from?: string }) => void
  runId?: string
}

export function normalizePlanStepsForEvent(steps: Step[]): PlanStepTodoItem[] {
  return (Array.isArray(steps) ? steps : []).map((s, i) => ({
    id: String(s.id || `step_${i + 1}_${s.agent}`),
    agent: String(s.agent || ''),
    query: String(s.query || '').slice(0, 280),
    order: i,
    status: 'pending' as const,
    optional: Boolean((s as { optional?: boolean }).optional)
  }))
}

export function emitPlanStepsEvent(opts: PlanStepsEmitterOpts, steps: Step[]) {
  const items = normalizePlanStepsForEvent(steps)
  if (!items.length) return
  opts.sendEvent({
    event: 'plan_steps',
    data: { steps: items, runId: opts.runId || undefined },
    from: 'manager'
  })
}

export function emitSingleStepPlanEvent(opts: PlanStepsEmitterOpts, agent: string, query: string) {
  const stepId = `step_${agent}`
  emitPlanStepsEvent(opts, [{ id: stepId, agent: agent as Step['agent'], query }])
  opts.sendEvent({
    event: 'step_status',
    data: buildStepStatus({ stepId, agent, status: 'running', pct: 50 }, opts.runId),
    from: 'manager'
  })
}
