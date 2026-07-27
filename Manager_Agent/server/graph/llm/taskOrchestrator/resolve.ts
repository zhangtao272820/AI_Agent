import { z } from 'zod'
import { safeJsonParse } from '../../core/shared/llmJson'
import type { TaskClause } from '../../core/routing/clauses'
import type { TaskConstraints } from '../../core/plan'
import {
  IntentClassifySchema,
  type IntentClassifyResult,
  PLAN_SHORTCUT_KINDS,
  coerceBool,
  coercePlanShortcut
} from '../intentClassifyLlm'
import type { PlanBlueprint } from '../planBlueprintLlm'
import type { LlmInvokeFn } from '../taskConstraintsLlm'
import type { TurnScopeLlmMode } from '../turnScopeLlm'
import type { ExecutableAgent } from '../../core/routing/routeFinalize'
import { constraintsFromMerged, formatSessionAnchorBlock, type SessionIntentAnchor } from '../../core/memory/multiTurnIntent'
import type { IntentRagRecallResult } from '../../core/rag/intentRagRecallCore'
import { ensureCodeInPipelineAgents } from '../../core/routing/clauses'
import { reconcileIntentClassifyDataPlane } from '../../orchestrate/routeOrchestration'
import type { MergedIntentUnderstandResult } from '../intentUnderstandLlm'
import { formatProbeForOrchestrator, isProbeDbRoutingRelevant } from '../../core/probe/probeInterpretation'
import { routingDecisionLlmTier } from '../../core/shared/modelTier'
import type { LlmInvokeOptions } from '../../core/shared/modelTier'
import { buildTopologyBlueprintFromCap } from '../planBlueprintLlm'
import { formatAgentBoundaryPrompt, formatEvolutionHintPreamble, unifiedRoutingEnvEnabled, isUnifiedOrchestratorEnabled, isLlmFirstRouteEnabled } from '../../orchestrate/unifiedRouting'
import { parseFirstBalancedJsonObject } from '../../core/shared/llmJson'
import type { TurnRoutingScope } from '../../core/routing/turnScope'
import type { BaseMessage } from '@langchain/core/messages'
import type { OrchestratorParseFailure } from './schemas'
import { bundleFromOrchestratorRaw, parseCompactOrchestratorJson, parseOrchestratorJson } from './parseBundle'
import { isOrchestratorCompactFirst } from '../../orchestrate/orchestratorHeuristic'

export type OrchestratorLlmResult = {
  bundle: TaskOrchestratorBundle | null
  stage: 'full' | 'compact' | 'none'
  failures: OrchestratorParseFailure[]
}

const COMPACT_SCHEMA_HINT =
  '{"turnScopeMode":"current_only|topic_shift","dataSources":["rag"|"crawler"],"suggestedAgents":["rag"],"allowedAgents":["rag","crawler","clean","code","visualize"],"isDbAnchored":false,"needsWeb":true,"needsAdmin":false,"explicitWantsVisualize":true,"explicitWantsReport":false,"isMulti":true,"planShortcut":"none","requiresAgentPipeline":true,"allowChatWebDirect":false,"routedQuery":"...","confidence":0.7,"rationale":"...","complexity":"low|mid|high","needsPlanPreview":false,"suggestedPosture":"agent","upgradeReason":"","upgradeConfidence":0.7}'

async function invokeOrchestratorLlm(
  input: {
    messages: BaseMessage[]
    lastUser: string
    routingContext: string
    turnScopeHint?: string
    probe?: { db?: { matched?: boolean; tables?: string[] }; rag?: { hits?: number } } | null
    sessionAnchor?: SessionIntentAnchor | null
    ragRecall?: IntentRagRecallResult | null
    evolutionHint?: string
    judgeFeedback?: string
    puStackHint?: string
    llmInvoke: LlmInvokeFn
    state: unknown
  },
  mode: 'full' | 'compact',
  invokeOptions?: Pick<LlmInvokeOptions, 'quiet' | 'thinkingLabel'>
): Promise<{ text: string }> {
  const last = String(input.lastUser || '').trim()
  const ctx = String(input.routingContext || last).trim().slice(0, 2200)
  const anchorBlock = formatSessionAnchorBlock(input.sessionAnchor)
  const ragBlock = String(input.ragRecall?.text || '').trim()
  const evo = String(input.evolutionHint || '').trim()

  const systemFull = [
    '你是总管 Agent 的「统一任务编排器」（Semantic Router + Plan-and-Execute / LLMCompiler）。',
    formatAgentBoundaryPrompt(),
    '【权威】仅【用户末轮】决定 dataSources、suggestedAgents、allowedAgents、clauses、planBlueprint；Probe/PU/历史/经验不得扩写 cap。',
    '相似主题的新任务若末轮未提数据库/人名，禁止继承上一轮 db/admin 子句。',
    '【子句拆解】复合任务须 clauses≥2，每子句绑定 agents；禁止把整段用户原话复制到每个 blueprint queryFocus。',
    '【示例·单源DB】「[地区]+[年龄区间]+[人群]按[维度]分布」→ planShortcut=db_only, dataSources=[db], allowedAgents=[db], isDbAnchored=true, requiresAgentPipeline=false, planBlueprint 一步 db。',
    '【示例·DB+计算】「[业务记录]有多少条？[某指标]偏高占比是多少？」→ dataSources=[db], allowedAgents=[db,code], planShortcut=none, requiresAgentPipeline=true, 蓝图 db→code。',
    '【示例·三源复合】「知识库查[规范]，数据库查[统计对象]，网站查[外部价格]，汇总出图」→ clauses 三条分别 rag/db/crawler，dataSources 三者齐全，planBlueprint 每步独立 queryFocus，allowedAgents 含 clean/code/visualize。',
    '【示例·协作·RAG+联网】「对照知识库[制度]，网上查最新[政策通知]」→ rag+crawler，needsWeb=true，两步独立 queryFocus。',
    '【示例·协作·附件+库表】「分析上传的[附件类型]，并查数据库里[对象]的历史[指标]」→ multimodal+db，附件步 queryFocus 写识图任务。',
    '【示例·协作·RAG+DB+Admin】三子句并行：rag 查规范、db 查记录、admin 查出行；needsAdmin=true，isDbAnchored=true，dataSources=[rag,db]，allowedAgents 含 rag/db/admin/clean/code/visualize，admin 独立一步 queryFocus，禁止把 admin 合并进 visualize。',
    '【示例·协作·RAG+DB+天气+简报】「知识库查[补贴标准]，数据库查[区域统计]，查[城市]今日天气，写综合简报」→ dataSources=[rag,db]（不含 crawler）；needsWeb=false；needsAdmin=true；explicitWantsReport=true；requiresAgentPipeline=true；planShortcut=none；clauses≥4：rag / db / admin / report（报告子句 agents=[report]）；allowedAgents 须含 rag、db、admin、code、report（有 report 须有 code）；planBlueprint 含 report 独立一步，queryFocus=撰写对比/综合简报；禁止把写报告併入 clean 或省略 report。',
    '【示例·澄清追问】「知识库中服务比对，同上面是环境指标还是指标汇总对比」→ turnScopeMode=current_only, dataSources=[rag], allowedAgents=[rag], clauses 一条 rag 澄清/说明，禁止因历史轮次或 probe 加 db/admin/clean/code。',
    'dataSources 只含用户明确需要的数据面：db | rag | crawler；Probe 命中文档 ≠ 用户要知识库。',
    'needsAdmin 为 true 时 suggestedAgents 须含 admin；否则 needsAdmin=false。',
    'clarifyKind：none|slot|plane|output_disambiguation；output_disambiguation 时 needsClarify=false。',
    'planShortcut 仅 none|db_chart|db_only|rag_only|admin_only|chitchat_only；复合任务用 none。',
    '【升档 B1】同一次 JSON 输出 complexity(low|mid|high)、needsPlanPreview、suggestedPosture(ask|plan|agent|debug)、upgradeReason(≤200)、upgradeConfidence(0-1)。',
    '复杂/多子句/写副作用/证据不足 → needsPlanPreview=true 或 suggestedPosture=plan；低风险单跳只读保持 needsPlanPreview=false、suggestedPosture=agent。',
    '只输出 JSON，无 markdown。'
  ].join('\n')

  const systemCompact = [
    '你是总管 Agent 的「紧凑编排器」。',
    formatAgentBoundaryPrompt(),
    '仅输出 dataSources、suggestedAgents、allowedAgents、flags；以【用户末轮】为唯一权威。',
    '只输出 JSON，无 markdown。'
  ].join('\n')

  const schemaHint =
    mode === 'compact'
      ? `schema: ${COMPACT_SCHEMA_HINT}`
      : 'schema: {"turnScopeMode":"current_only|continuation|topic_shift|chitchat","directChitchatSynth":bool,"coalescedTask":string,"clauses":[{"id":"c1","text":"...","agents":["rag"]}],"timeHints":[],"subjectHints":[],"fieldHints":[],"wantsVisualize":bool,"wantsReport":bool,"dataSources":["rag"|"db"|"crawler"],"primaryIntent":"...","isMulti":bool,"suggestedAgents":[],"isDbAnchored":bool,"needsAdmin":bool,"needsWeb":bool,"explicitWantsReport":bool,"explicitWantsVisualize":bool,"planShortcut":"none|...","requiresAgentPipeline":bool,"allowChatWebDirect":bool,"intent":"...","allowedAgents":[],"routedQuery":"...","needsWebSearch":bool,"needsClarify":bool,"clarifyKind":"none|slot|plane|output_disambiguation","clarifyQuestions":[],"planBlueprint":{"rationale":"","steps":[{"agent":"rag","queryFocus":"..."}]},"confidence":0-1,"rationale":"...","complexity":"low|mid|high","needsPlanPreview":bool,"suggestedPosture":"ask|plan|agent|debug","upgradeReason":"...","upgradeConfidence":0-1}'

  return input.llmInvoke(
    'route',
    input.state,
    [
      ['system', mode === 'compact' ? systemCompact : systemFull],
        [
          'human',
          [
            input.turnScopeHint,
            `【用户末轮】\n${last.slice(0, 1200)}`,
            `【路由上下文】\n${ctx}`,
            anchorBlock,
            formatProbeForOrchestrator(input.probe),
            ragBlock ? `【意图 RAG 召回（参考，不一致则以末轮为准）】\n${ragBlock.slice(0, 900)}` : '',
            input.puStackHint ? String(input.puStackHint).slice(0, 1200) : '',
            evo ? `${formatEvolutionHintPreamble()}\n${evo.slice(0, 600)}` : '',
            input.judgeFeedback
              ? `【上轮审查未通过，须修正】\n${String(input.judgeFeedback).slice(0, 900)}`
              : '',
            schemaHint
          ]
            .filter(Boolean)
            .join('\n\n')
        ]
    ],
    {
      tier: routingDecisionLlmTier(input.state),
      ...(invokeOptions ?? {})
    }
  )
}

/**
 * 统一编排 LLM：LLM-First 仅 full schema + 解析失败时最多 2 次 repair；否则 compact-first 可选。
 */
export async function resolveTaskOrchestrationByLlm(input: {
  messages: BaseMessage[]
  lastUser: string
  routingContext: string
  turnScopeHint?: string
  probe?: { db?: { matched?: boolean; tables?: string[] }; rag?: { hits?: number } } | null
  sessionAnchor?: SessionIntentAnchor | null
  ragRecall?: IntentRagRecallResult | null
  evolutionHint?: string
  judgeFeedback?: string
  puStackHint?: string
  llmInvoke: LlmInvokeFn
  state: unknown
}): Promise<OrchestratorLlmResult> {
  const last = String(input.lastUser || '').trim()
  const failures: OrchestratorParseFailure[] = []
  if (last.length < 2) return { bundle: null, stage: 'none', failures }

  const llmFirst = isLlmFirstRouteEnabled()
  const stages: Array<'full' | 'compact'> = llmFirst
    ? ['full']
    : isOrchestratorCompactFirst()
      ? ['compact', 'full']
      : ['full', 'compact']

  for (const stage of stages) {
    try {
      const resp = await invokeOrchestratorLlm(input, stage, llmFirst && stage === 'full' ? { thinkingLabel: '编排决策' } : undefined)
      if (stage === 'compact') {
        const compactParsed = parseCompactOrchestratorJson(String(resp.text ?? '').trim(), last)
        if (compactParsed.raw) {
          return { bundle: bundleFromOrchestratorRaw(compactParsed.raw), stage: 'compact', failures }
        }
        if (compactParsed.error) failures.push({ stage: 'compact', reason: compactParsed.error })
      } else {
        const fullParsed = parseOrchestratorJson(String(resp.text ?? '').trim(), last)
        if (fullParsed.raw) {
          return { bundle: bundleFromOrchestratorRaw(fullParsed.raw), stage: 'full', failures }
        }
        if (fullParsed.error) failures.push({ stage: 'full', reason: fullParsed.error })
      }
    } catch (e) {
      failures.push({
        stage,
        reason: e instanceof Error ? e.message : `${stage} LLM 异常`
      })
    }
  }

  const maxRepairs = llmFirst ? 2 : 1
  for (let r = 0; r < maxRepairs; r++) {
    const repairHint = failures.length
      ? failures.map((f) => `${f.stage}: ${f.reason}`).join('；')
      : undefined
    if (!repairHint) break
    try {
      const resp = await invokeOrchestratorLlm(
        {
          ...input,
          judgeFeedback: `JSON/schema 须修正（第 ${r + 1} 次）：${repairHint.slice(0, 600)}`
        },
        'full',
        { quiet: true }
      )
      const repaired = parseOrchestratorJson(String(resp.text ?? '').trim(), last)
      if (repaired.raw) {
        return { bundle: bundleFromOrchestratorRaw(repaired.raw), stage: 'full', failures }
      }
      if (repaired.error) failures.push({ stage: 'full', reason: `repair${r + 1}: ${repaired.error}` })
    } catch (e) {
      failures.push({ stage: 'full', reason: e instanceof Error ? e.message : `repair${r + 1} LLM 异常` })
    }
  }

  return { bundle: null, stage: 'none', failures }
}
