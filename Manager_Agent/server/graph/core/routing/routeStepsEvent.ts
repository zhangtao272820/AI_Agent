import type { ExecutableAgent } from './routeFinalize'
import { formatAgentCap, formatPlanExecutionDag } from '../../orchestrate/orchestrationNarrative'
import type { RoutePlanCardPayload } from './routePlanCard'
import type { Step } from '../../../utils/shared/taskPlan'

export type RouteCapItem = {
  agent: string
  role: 'cap'
}

type RouteCapEmitterOpts = {
  sendEvent: (event: { event: string; data?: unknown; from?: string }) => void
  runId?: string
}

/** 结构化路由 cap，供 UI 展示 Agent 白名单（非仅 thinking 文本） */
export function emitRouteCapEvent(
  opts: RouteCapEmitterOpts,
  input: {
    intent: string
    allowedAgents: ExecutableAgent[]
    routedQuery?: string
    rationale?: string
    needsWebSearch?: boolean
  }
) {
  const agents = [...new Set((input.allowedAgents || []).map((a) => String(a).trim()).filter(Boolean))]
  if (!agents.length && !input.intent) return
  opts.sendEvent({
    event: 'route_cap',
    data: {
      runId: opts.runId || undefined,
      intent: String(input.intent || ''),
      agents,
      capLabel: formatAgentCap(agents),
      routedQuery: String(input.routedQuery || '').slice(0, 280),
      rationale: String(input.rationale || '').slice(0, 320),
      needsWebSearch: input.needsWebSearch === true
    },
    from: 'manager'
  })
}

/** 编排计划卡：数据面 / 子句 / 蓝图 / lint / Judge 摘要 */
export function emitRoutePlanCardEvent(opts: RouteCapEmitterOpts, payload: RoutePlanCardPayload) {
  if (!payload.agents?.length && !payload.clauses?.length) return
  opts.sendEvent({
    event: 'route_plan_card',
    data: payload,
    from: 'manager'
  })
}

/** 结构化计划 DAG，供 UI 与 plan_steps 同步展示 */
export function emitPlanDagEvent(opts: RouteCapEmitterOpts, steps: Step[]) {
  const plan = (Array.isArray(steps) ? steps : []).filter((s) => s?.agent)
  if (!plan.length) return
  opts.sendEvent({
    event: 'plan_dag',
    data: {
      runId: opts.runId || undefined,
      dag: formatPlanExecutionDag(plan),
      agents: [...new Set(plan.map((s) => String(s.agent)))],
      stepCount: plan.length
    },
    from: 'manager'
  })
}
