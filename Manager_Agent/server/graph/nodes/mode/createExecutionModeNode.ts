import { wantsMultiCompareExecution } from '#agent-shared/synthShapePolicy'
import type { Step } from '../../../utils/shared/taskPlan'

import type { CreateExecutionModeNodeDeps } from './types'


export function createExecutionModeNode(deps: CreateExecutionModeNodeDeps) {
  const { opts, getEffectivePlanSteps, modeOverride, voteTargetsOverride } = deps
  const voteOnHeavy = String(process.env.MANAGER_VOTE_ON_HEAVY ?? '0').trim() === '1'
  return async (state: any) => {
    opts.sendEvent({ event: 'phase', data: 'execution_mode', from: 'manager' })
    const steps = getEffectivePlanSteps(state as any)
    const agents = steps.map((s: any) => String(s?.agent || ''))
    const hasReport = agents.includes('report')
    const hasVisualize = agents.includes('visualize')
    const hasMultiSource = ['rag', 'db', 'crawler'].filter((a) => agents.includes(a)).length >= 2
    const fetchPlaneCount = ['rag', 'db', 'crawler', 'admin'].filter((a) => agents.includes(a)).length
    const hasHeavy = hasReport || hasVisualize
    const question = String(state?.messages?.slice?.(-1)?.[0]?.content ?? state?.routedQuery ?? '').trim()
    const wantsMultiCompare = wantsMultiCompareExecution({ meta: state?.meta, planSteps: steps })

    let mode: 'serial' | 'parallel' | 'vote' = 'parallel'
    let reason = 'default_parallel'
    if (steps.length <= 2 && !hasHeavy && fetchPlaneCount < 2) {
      mode = 'serial'
      reason = 'short_pipeline'
    } else if (fetchPlaneCount >= 3) {
      mode = 'parallel'
      reason = 'multi_fetch_plane'
    } else if (voteOnHeavy && hasHeavy && hasMultiSource) {
      mode = 'vote'
      reason = 'multi_source_heavy_output'
    } else if (wantsMultiCompare && hasHeavy) {
      mode = 'vote'
      reason = 'user_requested_compare'
    }
    const override = String(modeOverride || '').trim().toLowerCase()
    if (override === 'serial' || override === 'parallel' || override === 'vote') {
      mode = override as any
      reason = `override:${override}`
    }
    const voteTargets = Array.isArray(voteTargetsOverride) && voteTargetsOverride.length
      ? voteTargetsOverride
      : mode === 'vote'
        ? ['report', 'visualize']
        : []

    opts.sendEvent({
      event: 'thinking',
      data: `执行模式：${mode}（${reason}）`,
      from: 'manager'
    })
    return {
      executionMode: {
        mode,
        reason,
        voteTargets,
        generatedAt: new Date().toISOString()
      }
    }
  }
}


