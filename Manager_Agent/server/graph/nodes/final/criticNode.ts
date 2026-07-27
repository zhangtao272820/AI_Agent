import type { CreateFinalNodesDeps } from './types'
import { buildCriticNodeRun } from './criticNodeRun'

export function buildCriticNode(deps: CreateFinalNodesDeps) {
  return buildCriticNodeRun(deps)
}
