
import type { CreateVoteAggregatorNodeDeps } from './types'


export function createVoteAggregatorNode(deps: CreateVoteAggregatorNodeDeps) {
  const { opts, config } = deps
  return async (state: any) => {
    opts.sendEvent({ event: 'phase', data: 'vote_aggregator', from: 'manager' })
    const mode = String(state?.executionMode?.mode || 'parallel')
    const enabled = mode === 'vote'
    const targets = Array.isArray(config?.targets) && config!.targets!.length
      ? config!.targets!
      : (Array.isArray(state?.executionMode?.voteTargets) ? state.executionMode.voteTargets : ['report', 'visualize'])
    const factWeight = Number.isFinite(Number(config?.factWeight)) ? Number(config?.factWeight) : 1
    const missingPenalty = Number.isFinite(Number(config?.missingPenalty)) ? Number(config?.missingPenalty) : 1
    const lengthPenalty = Number.isFinite(Number(config?.lengthPenalty)) ? Number(config?.lengthPenalty) : 0.0002
    const evidenceSupportWeight = Number.isFinite(Number(config?.evidenceSupportWeight)) ? Number(config?.evidenceSupportWeight) : 1.2
    const conflictPenalty = Number.isFinite(Number(config?.conflictPenalty)) ? Number(config?.conflictPenalty) : 1.5
    opts.sendEvent({
      event: 'thinking',
      data: `投票聚合策略：enabled=${enabled}, targets=${targets.join('/')}, weight(fact=${factWeight}, missing=${missingPenalty}, len=${lengthPenalty}, evidence=${evidenceSupportWeight}, conflict=${conflictPenalty})`,
      from: 'manager'
    })
    return {
      votePolicy: {
        enabled,
        targets,
        scoring: { factWeight, missingPenalty, lengthPenalty, evidenceSupportWeight, conflictPenalty },
        generatedAt: new Date().toISOString()
      }
    }
  }
}


