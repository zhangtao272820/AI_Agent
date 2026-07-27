import { z } from 'zod'
import type { TaskClause } from '../../core/routing/clauses'
import type { TaskConstraints } from '../../core/plan'
import { IntentClassifySchema, type IntentClassifyResult } from '../intentClassifyLlm'
import type { TurnScopeLlmMode } from '../turnScopeLlm'
import type { ExecutableAgent } from '../../core/routing/routeFinalize'
import { constraintsFromMerged } from '../../core/memory/multiTurnIntent'
import { ensureCodeInPipelineAgents } from '../../core/routing/clauses'
import { reconcileIntentClassifyDataPlane } from '../../orchestrate/routeOrchestration'
import type { MergedIntentUnderstandResult } from '../intentUnderstandLlm'
import { formatProbeForOrchestrator, isProbeDbRoutingRelevant } from '../../core/probe/probeInterpretation'
import { buildTopologyBlueprintFromCap } from '../planBlueprintLlm'
import {
  TaskOrchestratorSchema,
  type TaskOrchestratorRaw,
  type TaskOrchestratorBundle,
  ClauseSchema,
  assignClauseIds
} from './schemas'
import { normalizeOrchestratorPayload, parseOrchestratorJson, syncOrchestratorFlagsFromCap } from './parseCore'

export function buildOrchestratorBundleFromClassify(input: {
  classify: IntentClassifyResult
  lastUser: string
  turnScopeMode: TurnScopeLlmMode
  constraints?: TaskConstraints
}): TaskOrchestratorBundle {
  const last = String(input.lastUser || '').trim()
  const classify = reconcileIntentClassifyDataPlane(input.classify)
  const constraints = input.constraints ?? {
    timeHints: [],
    subjectHints: [],
    fieldHints: [],
    wantsVisualize: classify.explicitWantsVisualize,
    wantsReport: classify.explicitWantsReport
  }
  const agents = (classify.suggestedAgents?.length ? classify.suggestedAgents : []).filter(
    (a) => a !== 'db' || classify.isDbAnchored
  ) as ExecutableAgent[]
  const intent =
    classify.isMulti || agents.length >= 2
      ? 'multi'
      : String(agents[0] || classify.primaryIntent || 'multi')
  return bundleFromOrchestratorRaw({
    turnScopeMode: input.turnScopeMode,
    directChitchatSynth: false,
    clauses: [
      {
        id: 'c1',
        text: last.slice(0, 480),
        agents: agents.filter((a) => ['db', 'rag', 'crawler'].includes(a))
      }
    ],
    timeHints: constraints.timeHints,
    subjectHints: constraints.subjectHints,
    fieldHints: constraints.fieldHints,
    wantsVisualize: constraints.wantsVisualize,
    wantsReport: constraints.wantsReport,
    dataSources: classify.dataSources?.length
      ? classify.dataSources
      : classify.needsWeb
        ? (['crawler'] as const)
        : [],
    primaryIntent: classify.primaryIntent,
    isMulti: classify.isMulti,
    suggestedAgents: agents,
    isDbAnchored: classify.isDbAnchored,
    needsAdmin: classify.needsAdmin,
    needsWeb: classify.needsWeb,
    explicitWantsReport: classify.explicitWantsReport,
    explicitWantsVisualize: classify.explicitWantsVisualize,
    planShortcut: classify.planShortcut,
    requiresAgentPipeline: classify.requiresAgentPipeline,
    allowChatWebDirect: classify.allowChatWebDirect,
    intent,
    allowedAgents: agents,
    routedQuery: last.slice(0, 1200),
    needsWebSearch: classify.needsWeb,
    needsClarify: false,
    confidence: classify.confidence,
    rationale: classify.rationale || '意图识别回退编排'
  })
}

/** 最终保底：仅 routedQuery + 空 cap，由 Planner LLM 按用户末轮补全（禁止 probe/regex 扩写 dataSources） */
export function buildProbeAnchoredOrchestratorFallback(input: {
  lastUser: string
  turnScope: TurnRoutingScope
  probe?: { db?: { matched?: boolean; tables?: string[] }; rag?: { hits?: number } } | null
}): TaskOrchestratorBundle {
  const last = String(input.lastUser || '').trim()
  return buildOrchestratorBundleFromClassify({
    classify: reconcileIntentClassifyDataPlane({
      primaryIntent: 'multi',
      isMulti: true,
      suggestedAgents: [],
      isDbAnchored: false,
      needsAdmin: false,
      needsWeb: false,
      explicitWantsReport: false,
      explicitWantsVisualize: false,
      planShortcut: 'none',
      dataSources: [],
      requiresAgentPipeline: true,
      allowChatWebDirect: false,
      confidence: 0.45,
      rationale: '编排 LLM 均未通过；Planner 须仅依据用户末轮补全步骤（禁止引用经验/Probe 扩写 Agent）'
    }),
    lastUser: last,
    turnScopeMode: input.turnScope.mode,
    constraints: { timeHints: [], subjectHints: [], fieldHints: [], wantsVisualize: false, wantsReport: false }
  })
}

/** 合并理解回退：避免完整编排 JSON 失败时落回经典 route（易污染 db） */
export function buildOrchestratorBundleFromMerged(input: {
  merged: MergedIntentUnderstandResult
  lastUser: string
  turnScopeMode: TurnScopeLlmMode
}): TaskOrchestratorBundle {
  const last = String(input.lastUser || '').trim()
  const classify = reconcileIntentClassifyDataPlane(input.merged.classify)
  const agents = (classify.suggestedAgents?.length ? classify.suggestedAgents : []) as ExecutableAgent[]
  const allowed = agents.filter((a) => a !== 'db' || classify.isDbAnchored)
  const intent = classify.isMulti || allowed.length >= 2 ? 'multi' : String(classify.primaryIntent || allowed[0] || 'multi')
  const clauses: TaskClause[] = [
    {
      id: 'c1',
      text: input.merged.coalesced || last.slice(0, 480),
      agents: allowed.filter((a) => ['db', 'rag', 'crawler'].includes(a))
    }
  ]
  return bundleFromOrchestratorRaw({
    turnScopeMode: input.turnScopeMode,
    directChitchatSynth: false,
    coalescedTask: input.merged.coalesced,
    clauses,
    timeHints: input.merged.constraints.timeHints,
    subjectHints: input.merged.constraints.subjectHints,
    fieldHints: input.merged.constraints.fieldHints,
    wantsVisualize: input.merged.constraints.wantsVisualize,
    wantsReport: input.merged.constraints.wantsReport,
    dataSources: classify.dataSources?.length ? classify.dataSources : classify.needsWeb ? ['crawler'] : [],
    primaryIntent: classify.primaryIntent,
    isMulti: classify.isMulti,
    suggestedAgents: allowed,
    isDbAnchored: classify.isDbAnchored,
    needsAdmin: classify.needsAdmin,
    needsWeb: classify.needsWeb,
    explicitWantsReport: classify.explicitWantsReport,
    explicitWantsVisualize: classify.explicitWantsVisualize,
    planShortcut: classify.planShortcut,
    requiresAgentPipeline: classify.requiresAgentPipeline,
    allowChatWebDirect: classify.allowChatWebDirect,
    intent,
    allowedAgents: allowed,
    routedQuery: last.slice(0, 1200),
    needsWebSearch: classify.needsWeb,
    needsClarify: false,
    confidence: classify.confidence,
    rationale: classify.rationale || '合并理解回退编排'
  })
}

function buildIntentClassify(data: TaskOrchestratorRaw): IntentClassifyResult {
  return IntentClassifySchema.parse({
    primaryIntent: data.primaryIntent,
    isMulti: data.isMulti,
    suggestedAgents: data.suggestedAgents,
    isDbAnchored: data.isDbAnchored,
    needsAdmin: data.needsAdmin,
    needsWeb: data.needsWeb,
    explicitWantsReport: data.explicitWantsReport,
    explicitWantsVisualize: data.explicitWantsVisualize,
    planShortcut: data.planShortcut,
    dataSources: data.dataSources,
    requiresAgentPipeline: data.requiresAgentPipeline,
    allowChatWebDirect: data.allowChatWebDirect,
    confidence: data.confidence,
    rationale: data.rationale
  })
}

export function bundleFromOrchestratorRaw(raw: TaskOrchestratorRaw): TaskOrchestratorBundle {
  const allowedList = (raw.allowedAgents?.length ? raw.allowedAgents : raw.suggestedAgents).map(String)
  const synced = syncOrchestratorFlagsFromCap(allowedList, raw)
  const constraints = constraintsFromMerged({
    timeHints: raw.timeHints,
    subjectHints: raw.subjectHints,
    fieldHints: raw.fieldHints,
    wantsVisualize: synced.wantsVisualize,
    wantsReport: synced.wantsReport
  })
  let classify = buildIntentClassify(raw)
  const agents = new Set(classify.suggestedAgents || [])
  if (constraints.wantsVisualize) agents.add('visualize')
  if (constraints.wantsReport) agents.add('report')
  if (constraints.wantsVisualize || constraints.wantsReport) agents.add('code')
  const explicit = new Set([
    ...agents,
    ...(raw.clauses || []).flatMap((c) => c.agents || [])
  ])
  if (!explicit.has('admin')) {
    classify = { ...classify, needsAdmin: false, suggestedAgents: classify.suggestedAgents.filter((a) => a !== 'admin') }
  } else if (!agents.has('admin')) {
    agents.add('admin')
  }
  classify = {
    ...classify,
    suggestedAgents: ensureCodeInPipelineAgents([...agents]) as IntentClassifyResult['suggestedAgents']
  }

  const coalesced = String(raw.coalescedTask || '').trim()
  let planBlueprint = raw.planBlueprint ?? null
  if (!planBlueprint && raw.allowedAgents?.length) {
    planBlueprint =
      buildTopologyBlueprintFromCap({
        allowedAgents: raw.allowedAgents,
        clauses: assignClauseIds(raw.clauses),
        constraints,
        userTask: coalesced || raw.routedQuery
      }) ?? null
  }
  return {
    raw,
    turnScopeMode: raw.turnScopeMode,
    clauses: assignClauseIds(raw.clauses),
    constraints,
    intentClassify: classify,
    intent: String(raw.intent || raw.primaryIntent),
    allowedAgents: (raw.allowedAgents?.length ? raw.allowedAgents : raw.suggestedAgents) as ExecutableAgent[],
    routedQuery: String(raw.routedQuery).trim(),
    planBlueprint,
    needsWebSearch: raw.needsWebSearch === true || raw.needsWeb === true,
    needsClarify: raw.needsClarify === true,
    clarifyKind: (raw.clarifyKind ?? 'none') as TaskOrchestratorBundle['clarifyKind'],
    clarifyQuestions: raw.clarifyQuestions ?? [],
    directChitchatSynth: raw.turnScopeMode === 'chitchat' || raw.directChitchatSynth === true,
    coalescedTask: coalesced.length >= 6 ? coalesced.slice(0, 900) : undefined
  }
}

/** 单测：含 LLM 常见非法字段（如 planShortcut=rag_crawler）的归一化解析 */
export function parseOrchestratorPayloadForTest(raw: unknown, lastUser: string): TaskOrchestratorBundle | null {
  const normalized = normalizeOrchestratorPayload(raw, lastUser)
  const parsed = TaskOrchestratorSchema.safeParse(normalized)
  if (!parsed.success) return null
  return bundleFromOrchestratorRaw(parsed.data)
}

/** 单测：从 LLM 原始文本（含 markdown fence）解析 */
export function parseOrchestratorTextForTest(text: string, lastUser: string): TaskOrchestratorBundle | null {
  const parsed = parseOrchestratorJson(text, lastUser)
  if (!parsed.raw) return null
  return bundleFromOrchestratorRaw(parsed.raw)
}

/** 单测注入 */
export function parseOrchestratorForTest(raw: unknown): TaskOrchestratorBundle | null {
  const parsed = TaskOrchestratorSchema.safeParse(raw)
  if (!parsed.success) return null
  return bundleFromOrchestratorRaw(parsed.data)
}

