import crypto from 'node:crypto'
import type { Step } from '../../../utils/shared/taskPlan'
import { buildTaskPlan, getEffectivePlanSteps, normalizePlanSteps } from '../../core/plan'
import {
  buildPlanPreviewPayload,
  mergeConfirmedPlanSteps,
  shouldRequirePlanPreview
} from '../../core/plan/planPreview'
import { emitPlanStepsEvent } from '../../core/plan/planStepsEvent'
import { waitPlanConfirm } from '../../../utils/shared/planConfirmBridge'

import type { PlanPreviewNodeDeps } from './types'

export function createPlanPreviewNode(deps: PlanPreviewNodeDeps) {
  const { ensureNotAborted, opts, mergeMeta } = deps
  return async (state: any) => {
    ensureNotAborted()
    if (!shouldRequirePlanPreview(state)) return {}
    const steps = getEffectivePlanSteps(state)
    if (!steps.length) return {}

    const previewId = crypto.randomUUID()
    emitPlanStepsEvent(opts, steps)
    opts.sendEvent({ event: 'phase', data: 'plan_preview', from: 'manager' })
    opts.sendEvent({
      event: 'thinking',
      data: '已进入 Plan Mode：请确认或调整执行计划后再开始。',
      from: 'manager'
    })
    opts.sendEvent({
      event: 'thought_delta',
      data: { text: '计划已就绪，等待你确认后再执行。', done: false },
      from: 'manager'
    })
    opts.sendEvent({
      event: 'plan_preview',
      data: buildPlanPreviewPayload(steps, opts.runId, previewId, state),
      from: 'manager'
    })

    const decision = await waitPlanConfirm(opts.runId, previewId)
    if (decision.action === 'cancel') {
      opts.sendEvent({ event: 'thinking', data: '已取消执行计划。', from: 'manager' })
      opts.sendEvent({
        event: 'thought_delta',
        data: { text: '你取消了本次计划，未执行任何子 Agent。', done: true },
        from: 'manager'
      })
      return {
        meta: mergeMeta(state, { planPreviewCancelled: true, planConfirmed: false }),
        final: '已取消本次执行计划。你可以补充说明或换一种问法再试。'
      }
    }

    let nextSteps = steps
    if (Array.isArray(decision.steps) && decision.steps.length) {
      nextSteps = normalizePlanSteps(mergeConfirmedPlanSteps(steps, decision.steps as Step[]))
    }
    if (!nextSteps.length) {
      return {
        meta: mergeMeta(state, { planPreviewCancelled: true }),
        final: '执行计划为空，已取消。'
      }
    }

    const constraints = String(decision.constraints || '').trim().slice(0, 500)
    const skipped = steps.filter((s) => !nextSteps.some((n) => String(n.id) === String(s.id)))
    emitPlanStepsEvent(opts, nextSteps)
    for (const s of skipped) {
      opts.sendEvent({
        event: 'step_status',
        data: {
          stepId: String(s.id || ''),
          agent: String(s.agent || ''),
          status: 'skipped',
          runId: opts.runId
        },
        from: 'manager'
      })
    }

    opts.sendEvent({
      event: 'thinking',
      data: `计划已确认，开始执行 ${nextSteps.length} 个步骤…`,
      from: 'manager'
    })
    opts.sendEvent({
      event: 'thought_delta',
      data: {
        text: `计划已确认，将执行 ${nextSteps.length} 步${constraints ? '（已应用你补充的约束）' : ''}。`,
        done: false
      },
      from: 'manager'
    })
    return {
      plan: nextSteps,
      taskPlan: buildTaskPlan(state, nextSteps),
      meta: mergeMeta(state, {
        planConfirmed: true,
        planPreviewCancelled: false,
        ...(constraints ? { planConstraints: constraints } : {})
      })
    }
  }
}
