/**
 * 路由编排策略：由意图识别 LLM 产出，代码侧只做结构性合并（无正则判意图）。
 * 用于抑制「聊天式联网」误跳过 crawler/planner，以及 rag/db 数据源错配。
 */

import type { IntentClassifyResult } from '../llm/intentClassifyLlm'
import type { ExecutableAgent } from '../core/routing/routeFinalize'
import { adminExplicitlyRequested } from '../core/agent/agentPollutionGuard'
import { sortAgentsByPipelineOrder, type TaskClause } from '../core/routing/clauses'
import { clausesDeclareDataSource } from '../core/probe/probeRoutingAnchor'

export type DataSourceAgent = 'rag' | 'db' | 'crawler'

const DATA_SOURCE_SET = new Set<DataSourceAgent>(['rag', 'db', 'crawler'])

/** 用户是否明确要求业务库表数据面（结构性：仅认 intent 字段，不用 probe/ suggestedAgents） */
export function userRequiresDbDataPlane(ic: IntentClassifyResult | null | undefined): boolean {
  if (!ic) return false
  if (ic.primaryIntent === 'db') return true
  if (ic.isDbAnchored !== true) return false
  const llmSources = Array.isArray(ic.dataSources) ? ic.dataSources : []
  if (llmSources.includes('db') && !llmSources.includes('rag')) return true
  return ic.isDbAnchored === true
}

/** 从意图识别结果推断用户显式需要的数据面（优先 LLM dataSources；禁止从 suggestedAgents 推断 db） */
export function inferDataSourcesFromClassify(ic: IntentClassifyResult | null | undefined): DataSourceAgent[] {
  if (!ic) return []
  const fromLlm = (Array.isArray(ic.dataSources) ? ic.dataSources : [])
    .map((a) => String(a ?? '').trim() as DataSourceAgent)
    .filter((a) => DATA_SOURCE_SET.has(a))
  if (fromLlm.length) {
    if (fromLlm.includes('rag') && !fromLlm.includes('db') && !ic.isDbAnchored) {
      return [...new Set(fromLlm.filter((a) => a !== 'db'))]
    }
    return [...new Set(fromLlm)]
  }

  const out: DataSourceAgent[] = []
  if (ic.primaryIntent === 'rag' || ic.planShortcut === 'rag_only') out.push('rag')
  if (userRequiresDbDataPlane(ic)) out.push('db')
  if (ic.needsWeb) out.push('crawler')
  return out
}

/** 是否必须走完整 Agent 流水线（禁止 SERP→直答 synth、禁止跳过 planner） */
export function requiresAgentPipelineExecution(
  ic: IntentClassifyResult | null | undefined,
  allowedAgents: ExecutableAgent[]
): boolean {
  if (ic?.requiresAgentPipeline === true) return true
  if (ic?.allowChatWebDirect === false) return true
  const allowed = (Array.isArray(allowedAgents) ? allowedAgents : []).map((a) => String(a))
  if (!ic) {
    const heavy = allowed.filter((a) =>
      ['code', 'clean', 'visualize', 'report', 'admin', 'db', 'rag', 'crawler'].includes(a)
    )
    return heavy.length >= 2
  }
  if (ic.isMulti) return true
  if (ic.explicitWantsVisualize || ic.explicitWantsReport) return true
  if (adminExplicitlyRequested({ classify: ic, lastUser: undefined })) return true
  if (inferDataSourcesFromClassify(ic).length >= 2) return true
  if (allowed.includes('visualize') || allowed.includes('code') || allowed.includes('report')) return true
  if (ic.needsWeb && (ic.primaryIntent === 'rag' || ic.primaryIntent === 'db' || ic.primaryIntent === 'multi')) {
    return true
  }
  return false
}

/**
 * 按数据面对齐 allowedAgents：知识库任务不得因 probe/经验误塞 db；联网任务保留 crawler。
 */
export function alignAllowedAgentsWithDataPlane(
  allowed: ExecutableAgent[],
  ic: IntentClassifyResult | null | undefined,
  routerLlmAllowed: ExecutableAgent[]
): ExecutableAgent[] {
  if (!ic) return allowed
  const sources = inferDataSourcesFromClassify(ic)
  if (!sources.length) return allowed

  let out = [...allowed]
  const ragKb = sources.includes('rag') && !ic.isDbAnchored
  const needsDb = userRequiresDbDataPlane(ic)

  if (ragKb && !needsDb) {
    out = out.filter((a) => a !== 'db')
    if (sources.includes('rag') && !out.includes('rag')) out.push('rag')
  }

  if (needsDb && !out.includes('db') && userRequiresDbDataPlane(ic)) {
    out.push('db')
  }

  if (sources.includes('crawler') && ic.needsWeb && !out.includes('crawler')) {
    out.push('crawler')
  }

  if (ic.explicitWantsVisualize && !out.includes('visualize')) {
    out.push('visualize')
    if (!out.includes('code')) out.push('code')
  }

  const DATA_PLANE = new Set<DataSourceAgent>(['db', 'rag', 'crawler'])
  out = out.filter((a) => !DATA_PLANE.has(a as DataSourceAgent) || sources.includes(a as DataSourceAgent))

  return sortAgentsByPipelineOrder([...new Set(out)]) as ExecutableAgent[]
}

/** 是否应阻止路由层 db_only 收敛（知识库/多源任务） */
export function shouldBlockDbOnlyCoalesce(ic: IntentClassifyResult | null | undefined): boolean {
  if (!ic) return false
  if (ic.planShortcut === 'db_only' && ic.isDbAnchored === true && ic.requiresAgentPipeline !== true) {
    return false
  }
  if (ic.primaryIntent === 'rag' && !ic.isDbAnchored) return true
  const sources = inferDataSourcesFromClassify(ic)
  if (sources.length >= 2) return true
  if (sources.includes('rag') && !sources.includes('db') && !ic.isDbAnchored) return true
  if (ic.requiresAgentPipeline) return true
  if (ic.isMulti && sources.length >= 2) return true
  return false
}

const PIPELINE_EXEC_AGENTS = new Set<string>([
  'db',
  'rag',
  'code',
  'crawler',
  'clean',
  'visualize',
  'report',
  'admin'
])

/** 复合流水线须 intent=multi，避免 web_search 后误进单 Agent 节点 */
export function ensureMultiIntentForPipeline(
  intent: string,
  allowedAgents: ExecutableAgent[],
  pipelineRequired: boolean
): string {
  if (!pipelineRequired) return intent
  const execCount = (Array.isArray(allowedAgents) ? allowedAgents : []).filter((a) =>
    PIPELINE_EXEC_AGENTS.has(String(a))
  ).length
  if (execCount >= 2) return 'multi'
  const i = String(intent || '').trim()
  if (i === 'crawler' || i === 'gui' || i === 'rag' || i === 'db') return 'multi'
  return intent
}

/**
 * 校正意图识别：probe/复合路由不得把「知识库」升格为 db。
 * 以 LLM 产出的 dataSources / primaryIntent 为准，代码只做一致性合并。
 */
export function reconcileIntentClassifyDataPlane(
  ic: IntentClassifyResult,
  clauses?: TaskClause[]
): IntentClassifyResult {
  const sources = inferDataSourcesFromClassify(ic)
  const out: IntentClassifyResult = {
    ...ic,
    suggestedAgents: [...(ic.suggestedAgents || [])],
    dataSources: [...(Array.isArray(ic.dataSources) ? ic.dataSources : [])]
  }

  const llmSources = (Array.isArray(ic.dataSources) ? ic.dataSources : []).filter((a) =>
    DATA_SOURCE_SET.has(a as DataSourceAgent)
  ) as DataSourceAgent[]

  if (clausesDeclareDataSource(clauses, 'rag') && !out.dataSources?.includes('rag')) {
    out.dataSources = [...(out.dataSources || []), 'rag']
  }
  if (clausesDeclareDataSource(clauses, 'db') && !out.dataSources?.includes('db')) {
    out.dataSources = [...(out.dataSources || []), 'db']
    if (!out.isDbAnchored) out.isDbAnchored = true
  }
  if (clausesDeclareDataSource(clauses, 'crawler') && !out.dataSources?.includes('crawler')) {
    out.dataSources = [...(out.dataSources || []), 'crawler']
    out.needsWeb = true
  }

  if (llmSources.includes('rag') && !llmSources.includes('db')) {
    out.isDbAnchored = false
    if (out.primaryIntent === 'db') out.primaryIntent = 'rag'
    out.suggestedAgents = out.suggestedAgents.filter((a) => a !== 'db')
    out.dataSources = llmSources.filter((a) => a !== 'db')
    if (out.planShortcut === 'db_only' || out.planShortcut === 'db_chart') {
      out.planShortcut = out.explicitWantsVisualize || out.explicitWantsReport || out.isMulti ? 'none' : 'rag_only'
    }
  }

  if (ic.primaryIntent === 'rag' || ic.planShortcut === 'rag_only') {
    out.isDbAnchored = false
    out.suggestedAgents = out.suggestedAgents.filter((a) => a !== 'db')
    if (!out.dataSources?.length) out.dataSources = ic.needsWeb ? ['rag', 'crawler'] : ['rag']
  }

  if ((ic.primaryIntent === 'multi' || ic.isMulti) && ic.needsWeb && !userRequiresDbDataPlane(ic)) {
    out.isDbAnchored = false
    out.suggestedAgents = out.suggestedAgents.filter((a) => a !== 'db')
    if (!out.dataSources?.length) {
      out.dataSources = ic.needsWeb ? (['crawler'] as DataSourceAgent[]) : []
    } else {
      out.dataSources = out.dataSources.filter((a) => a !== 'db')
      if (ic.needsWeb && !out.dataSources.includes('crawler')) out.dataSources.push('crawler')
    }
  }

  if (sources.includes('rag') && !userRequiresDbDataPlane(out)) {
    out.suggestedAgents = out.suggestedAgents.filter((a) => a !== 'db')
    if (out.primaryIntent === 'db') out.primaryIntent = 'rag'
  }

  if (
    userRequiresDbDataPlane(ic) &&
    llmSources.includes('db') &&
    !llmSources.includes('rag') &&
    !clausesDeclareDataSource(clauses, 'rag')
  ) {
    out.suggestedAgents = out.suggestedAgents.filter((a) => a !== 'rag')
    if (!out.dataSources?.length || !out.dataSources.includes('db')) {
      out.dataSources = ic.needsWeb ? ['db', 'crawler'] : ['db']
    }
  }

  const userWantsRag =
    clausesDeclareDataSource(clauses, 'rag') ||
    llmSources.includes('rag') ||
    (out.dataSources || []).includes('rag')

  if (
    (ic.primaryIntent === 'multi' || ic.isMulti) &&
    ic.needsWeb &&
    userRequiresDbDataPlane(ic) &&
    llmSources.includes('db') &&
    !llmSources.includes('rag') &&
    !userWantsRag
  ) {
    out.isDbAnchored = true
    out.suggestedAgents = out.suggestedAgents.filter((a) => a !== 'rag')
    out.dataSources = (out.dataSources || []).filter((d) => d !== 'rag')
    if (!out.dataSources.includes('db')) out.dataSources.unshift('db')
    if (ic.needsWeb && !out.dataSources.includes('crawler')) out.dataSources.push('crawler')
  }

  if (
    clausesDeclareDataSource(clauses, 'rag') &&
    clausesDeclareDataSource(clauses, 'db') &&
    ic.needsWeb
  ) {
    out.isDbAnchored = true
    if (!out.dataSources?.includes('rag')) out.dataSources = [...(out.dataSources || []), 'rag']
    if (!out.dataSources?.includes('db')) out.dataSources = ['db', ...(out.dataSources || []).filter((d) => d !== 'db')]
    if (!out.dataSources?.includes('crawler')) out.dataSources.push('crawler')
    if (!out.suggestedAgents.includes('rag')) out.suggestedAgents.push('rag')
  }

  return out
}

/** 最终路由 cap：无 isDbAnchored 时一律剔除 db（probe/bandit/路由 LLM 误加） */
export function stripDbUnlessDbAnchored(
  allowed: ExecutableAgent[],
  ic: IntentClassifyResult | null | undefined
): ExecutableAgent[] {
  if (userRequiresDbDataPlane(ic)) return allowed
  const out = allowed.filter((a) => a !== 'db')
  return sortAgentsByPipelineOrder(out) as ExecutableAgent[]
}
