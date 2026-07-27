import type { CreatePlanNodeDeps } from './types'
import type { createPlanQueryHelpers } from './planQueryHelpers'
import { runPlanNodeBody } from './planNodeBody'

export function createPlanNodeRun(deps: CreatePlanNodeDeps, helpers: ReturnType<typeof createPlanQueryHelpers>) {
  return async (state: any) => runPlanNodeBody(state, deps, helpers)
}
