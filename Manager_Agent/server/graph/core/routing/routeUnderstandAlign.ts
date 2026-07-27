/**
 * 路由 allowedAgents 与合并理解 / 子句拆解 / 流水线拓扑对齐（通用领域，无正则）。
 * 参考 Plan-and-Execute：Router 选 Agent 集合，Planner 定 DAG；此处保证集合完整且含硬依赖。
 */

import type { IntentClassifyResult } from '../../llm/intentClassifyLlm'
import type { TaskConstraints } from '../plan'
import {
  ensureCodeInPipelineAgents,
  sortAgentsByPipelineOrder,
  type TaskClause
} from './clauses'
import {
  supplementAllowedFromClauses,
  supplementAllowedFromTaskConstraints,
  type ExecutableAgent
} from './routeFinalize'
import { inferPipelineHintsStructural } from '../../llm/pipelineHintsLlm'
import { parseUserExplicitCapabilities } from '../memory/userIntentSupremacy'
import { resolveManagerEnvBool } from '../../../utils/platform/managerEnvModes'

export function isRouteUnderstandAlignEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveManagerEnvBool('MANAGER_ROUTE_UNDERSTAND_ALIGN', env)
}

/** 合并理解节点建议的 Agent（置信度门槛可配） */
export function agentsFromIntentClassify(
  ic: IntentClassifyResult | null | undefined,
  minConfidence = 0.52
): ExecutableAgent[] {
  if (!ic) return []
  if (Number(ic.confidence ?? 0) < minConfidence) return []
  return (ic.suggestedAgents || []).filter(Boolean) as ExecutableAgent[]
}

/** 子句拆解 agent 并集 */
export function agentsFromTaskClauses(clauses: TaskClause[]): ExecutableAgent[] {
  const out: ExecutableAgent[] = []
  const seen = new Set<string>()
  for (const c of clauses) {
    for (const a of c.agents || []) {
      const x = String(a || '').trim()
      if (!x || seen.has(x)) continue
      seen.add(x)
      out.push(x as ExecutableAgent)
    }
  }
  return out
}

/**
 * 路由 LLM 输出后：与意图识别、子句、任务约束、流水线启发对齐，并补全 code/clean 硬依赖。
 */
export function alignAllowedAgentsWithUnderstanding(input: {
  routerAllowed: ExecutableAgent[]
  intentClassify?: IntentClassifyResult | null
  clauses?: TaskClause[]
  constraints?: TaskConstraints | null
  dbOnlyRoute?: boolean
  ragOnlyRoute?: boolean
  userText?: string
}): ExecutableAgent[] {
  if (!isRouteUnderstandAlignEnabled()) {
    return sortAgentsByPipelineOrder([...input.routerAllowed]) as ExecutableAgent[]
  }

  let merged = [...input.routerAllowed]

  if (!input.dbOnlyRoute && !input.ragOnlyRoute) {
    const fromIc = agentsFromIntentClassify(input.intentClassify)
    if (fromIc.length) {
      merged = [...new Set([...merged, ...fromIc])] as ExecutableAgent[]
    }
    const clauseAgents = agentsFromTaskClauses(input.clauses || [])
    merged = supplementAllowedFromClauses(merged, clauseAgents)
    merged = supplementAllowedFromTaskConstraints(merged, input.constraints, {
      dbOnlyRoute: input.dbOnlyRoute,
      ragOnlyRoute: input.ragOnlyRoute,
      intentClassify: input.intentClassify ?? null
    })

    const structural = inferPipelineHintsStructural({
      allowedAgents: merged,
      constraints: input.constraints ?? null
    })
    if (structural?.needsCode && !merged.includes('code')) {
      merged = [...merged, 'code']
    }
    if (structural?.needsClean && !merged.includes('clean')) {
      merged = [...merged, 'clean']
    }

    const userText = String(input.userText || '').trim()
    if (userText) {
      const caps = parseUserExplicitCapabilities(userText)
      for (const a of caps.allowedAgents) {
        if (!merged.includes(a as ExecutableAgent)) merged.push(a as ExecutableAgent)
      }
    }

    merged = ensureCodeInPipelineAgents(merged) as ExecutableAgent[]
  }

  return sortAgentsByPipelineOrder([...new Set(merged)]) as ExecutableAgent[]
}

export function describeAllowedAgentDelta(before: ExecutableAgent[], after: ExecutableAgent[]): string {
  const added = after.filter((a) => !before.includes(a))
  if (!added.length) return ''
  return `+${added.join('、')}`
}
