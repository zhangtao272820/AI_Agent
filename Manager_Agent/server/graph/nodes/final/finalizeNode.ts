import type { CreateFinalNodesDeps } from './types'
import { buildFinalizeNodeRun } from './finalizeNodeRun'

export function buildFinalizeNode(deps: CreateFinalNodesDeps) {
  return buildFinalizeNodeRun(deps)
}
