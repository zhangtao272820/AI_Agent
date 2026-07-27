import type { CreateRouterNodeDeps } from './types'
import { runRouterNodeBody } from './routerNodeBody'

export function createRouterNodeRun(deps: CreateRouterNodeDeps) {
  return async (state: any) => runRouterNodeBody(state, deps)
}
