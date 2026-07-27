/**
 * 路由权威层（Plan-and-Execute / LLMCompiler 对齐）：
 * - Router LLM + decompose 子句 = allowedAgents 下限
 * - intentClassify 仅作 hint，不得否决 Router 显式 agent
 * - 单源收敛（rag_only/db_only）仅当 Router 与子句均未表达复合意图
 */

import type { IntentClassifyResult } from '../../llm/intentClassifyLlm'
import type { ExecutableAgent } from './routeFinalize'

const EXECUTION_AGENTS = new Set<string>([
  'db',
  'rag',
  'code',
  'crawler',
  'admin',
  'clean',
  'visualize',
  'report',
  'multimodal',
  'music',
  'video',
  'gui'
])

export type RouteAuthorityInput = {
  routerLlmAllowed: ExecutableAgent[]
  clauseAgents?: string[]
  intentClassify?: Pick<IntentClassifyResult, 'isMulti' | 'planShortcut' | 'suggestedAgents'> | null
}

/** Router + 子句中表达的不同执行 agent 数量（结构性，非正则） */
export function countDistinctExecutionAgents(input: RouteAuthorityInput): number {
  const seen = new Set<string>()
  for (const a of input.routerLlmAllowed ?? []) {
    const x = String(a ?? '').trim()
    if (EXECUTION_AGENTS.has(x)) seen.add(x)
  }
  for (const a of input.clauseAgents ?? []) {
    const x = String(a ?? '').trim()
    if (EXECUTION_AGENTS.has(x)) seen.add(x)
  }
  return seen.size
}

/** 是否允许路由层收敛为单源 rag/db（禁止覆盖 Router 已判定的复合任务） */
export function canCoalesceRouteToSingleSource(input: RouteAuthorityInput): boolean {
  const shortcut = input.intentClassify?.planShortcut
  if (
    (shortcut === 'db_only' || shortcut === 'rag_only' || shortcut === 'admin_only') &&
    input.intentClassify?.requiresAgentPipeline !== true
  ) {
    return true
  }
  if (countDistinctExecutionAgents(input) >= 2) return false
  if (input.intentClassify?.isMulti === true) {
    const ds = (input.intentClassify as { dataSources?: string[] })?.dataSources ?? []
    if (ds.length >= 2) return false
  }
  if (input.intentClassify?.planShortcut === 'none' && input.intentClassify?.requiresAgentPipeline === true) {
    return false
  }
  const suggested = input.intentClassify?.suggestedAgents ?? []
  const distinctSuggested = suggested.filter((a) => EXECUTION_AGENTS.has(String(a))).length
  if (distinctSuggested >= 2) return false
  return true
}

/** 合并 Router / 子句 / classify 建议为 Planner cap（只增不减 Router 显式项） */
export function mergeRouteAllowedCap(input: RouteAuthorityInput): ExecutableAgent[] {
  const merged = new Set<ExecutableAgent>()
  for (const a of input.routerLlmAllowed ?? []) merged.add(a)
  for (const raw of input.clauseAgents ?? []) {
    const a = String(raw ?? '').trim() as ExecutableAgent
    if (EXECUTION_AGENTS.has(a)) merged.add(a)
  }
  for (const a of input.intentClassify?.suggestedAgents ?? []) {
    const x = String(a ?? '').trim() as ExecutableAgent
    if (EXECUTION_AGENTS.has(x) && input.routerLlmAllowed.includes(x)) merged.add(x)
  }
  return [...merged]
}
