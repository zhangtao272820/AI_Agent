import type { CreateFinalNodesDeps } from './types'
import { buildSynthNodeRun } from './synthNodeRun'

export function buildSynthNode(deps: CreateFinalNodesDeps) {
  return buildSynthNodeRun(deps)
}
