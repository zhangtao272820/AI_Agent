import type { CreateMultiNodeDeps } from './types'
import { runMultiNodeBody } from './multiNodeBody'

export function createMultiNodeRun(deps: CreateMultiNodeDeps) {
  return async (state: any) => runMultiNodeBody(state, deps)
}
