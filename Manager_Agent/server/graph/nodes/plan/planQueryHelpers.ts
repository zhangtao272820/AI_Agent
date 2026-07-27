import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { buildAgentScopedQuery, clausesFromMeta, isClauseDecomposeEnabled, agentsFromClauses } from '../../core/routing/clauses'
import { stepDispatchDraftFromMeta } from '../../core/proPuStack'
import { composeManagerPromptContext } from '../../core/plan/contextComposer'
import { sanitizePlanSteps } from '../../core/stepIsolation'
import {
  applyRoutePlanCoverage,
  finalizePlanForExecution,
  normalizePlanSteps,
  reconcilePlanWithRoute
} from '../../core/plan'
import { validateAndPreparePlan } from '../../core/plan/planValidate'
import {
  mergePlanWithClauseMaterialization
} from '../../core/routing/clausePlanBinding'
import { resolvePipelineHints, pipelineHintsFromMeta } from '../../llm/pipelineHintsLlm'
import { applyMediaPlanTopology, resolveMediaPlanTopology } from '../../llm/mediaPlanLlm'
import {
  effectiveUserTask,
  preferCurrentTurnScope,
  routingHeuristicsUserText
} from '../../core/text'
import { unhealthyAgentsForPrompt } from '../../core/agent/agentRegistry'
import type { Step } from '../../../utils/shared/taskPlan'
import { parsePlanLlmJson, PLAN_JSON_EXAMPLE } from '../../core/shared/llmJson'
import { PLANNER_INTRO, getPlannerPlaybookRules, getAgentScopedPlaybookAddons } from '../../core/evolution/playbookPrompts'
import { isAdminBlockedForState } from '../../core/db/writeGate'
import { resolveTaskConstraints, taskConstraintsFromMeta } from '../../llm/taskConstraintsLlm'
import { intentClassifyFromMeta } from '../../llm/intentClassifyLlm'
import {
  blueprintCoversRequiredAgents,
  formatPlanBlueprintForPrompt,
  isPlanBlueprintMaterializeEnabled,
  isRepeatingUserTask,
  materializeStepsFromBlueprint,
  planBlueprintFromMeta,
  resolvePlanBlueprintByLlm
} from '../../llm/planBlueprintLlm'
import { adminScopedQueryFromMeta } from '../../../utils/admin/managerAdminTaskPayload'
import { shouldMaterializePlanFromBlueprint } from '../../core/routing/proRoutePolicy'
import { repairMissingPlanStepsByLlm } from '../../llm/planRepairLlm'
import { formatWebExecutionModeForPrompt, webExecutionModeFromMeta } from '../../llm/webTaskStructuralLlm'
import {
  formatPlanOrchestrationSummary,
  isOrchVerbose,
  notePlanInternalFix
} from '../../orchestrate/orchestrationNarrative'
import { emitPlanDagEvent } from '../../core/routing/routeStepsEvent'
import { emitPlanStepsEvent } from '../../core/plan/planStepsEvent'
import { coerceConstraintsForSimpleDbQuery, coerceConstraintsForSimpleRagQuery } from '../../../utils/db/managerDbSchemaHintsPolicy'
import { ensureDbProbeHintsForPlan } from '../../../utils/db/managerDbHintsLlm'
import { probeAdminAgentReadiness, isAdminReadinessProbeEnabled } from '../../../utils/admin/managerAdminReadinessProbe'
import { buildAgentRegistry } from '../../core/agent/agentRegistry'
import { agentWsUrlToHttpOrigin } from '../../../utils/platform/agentEndpoints'
import { enrichTaskPlanWithDbPlan } from '../../core/db/dbPrefetch'
import { resolveDbPrefetchQuestionFromState, resolveDbStepQuestionSync } from '../../core/db/dbStepQuestion'
import { buildDbChartShortcutPlan, buildAdminOnlyShortcutPlan, buildDbOnlyShortcutPlan, buildRagOnlyShortcutPlan, shouldUseAdminOnlyShortcut, shouldUseDbChartShortcut, shouldUseDbOnlyShortcut, shouldUseRagOnlyShortcut } from '../../core/plan/planShortcuts'
import { shouldSkipLegacyPlanShortcuts, shouldSkipPlanRuleFallback } from '../../orchestrate/unifiedRouting'
import type { TaskConstraints } from '../../core/plan'
import { PLANNER_RULES_FALLBACK, stripAdminStepsIfBlocked } from './helpers'
import type { CreatePlanNodeDeps } from './types'

export function createPlanQueryHelpers(deps: CreatePlanNodeDeps) {
  const { opts, lastUserText, runId } = deps
    const publishPlanUi = (plan: Step[]) => {
      emitPlanStepsEvent({ sendEvent: opts.sendEvent, runId }, plan)
      emitPlanDagEvent({ sendEvent: opts.sendEvent, runId }, plan)
    }

    const planHeuristicsFor = (st: any) => {
      const last = String(lastUserText(st.messages) || '').trim()
      const isolated =
        Boolean(st.meta?.standaloneMediaRoute) ||
        st.meta?.turnScope === 'current_only' ||
        preferCurrentTurnScope(st.messages as any, last)
      if (isolated) return String(st.routedQuery || '').trim() || last
      return (
        String(st.meta?.nlHeuristicTask || '').trim() ||
        String(routingHeuristicsUserText(st.messages as any) || '').trim() ||
        last ||
        effectiveUserTask(st.messages as any, st.routedQuery)
      )
    }

    const plannerQueryForAgent = (agent: Step['agent'], fallback: string, st: any) => {
      const focus = String(fallback || '').trim()
      const draft = stepDispatchDraftFromMeta(st.meta)
      const draftHit = draft.find((d) => String(d.agent) === agent)
      const clauses = clausesFromMeta(st.meta)
      const fullTask =
        planHeuristicsFor(st) ||
        String(st.routedQuery || '').trim() ||
        String(lastUserText(st.messages) || '').trim() ||
        focus
      const acceptScoped = (text: string) => {
        const t = String(text || '').trim()
        if (t.length < 4) return ''
        if (isRepeatingUserTask(t, fullTask)) return ''
        return t.slice(0, 480)
      }

      const fromDraft = acceptScoped(draftHit?.scopedUserLanguage || '')
      if (fromDraft) return fromDraft

      const decompose =
        st.meta?.clauseDecomposeMode === 'orchestrator' ||
        st.meta?.clauseDecomposeMode === 'llm' ||
        clauses.length > 1 ||
        (isClauseDecomposeEnabled(deps.sessionId) && clauses.length > 1)

      if (decompose && clauses.length) {
        const scoped = acceptScoped(buildAgentScopedQuery(agent, clauses, focus || fullTask, st.meta))
        if (scoped) return scoped
        const bound = clauses.find((c) => c.agents?.includes(agent))
        const fromClause = acceptScoped(bound?.text || '')
        if (fromClause) return fromClause
        if (agent === 'admin') {
          const adminScoped = acceptScoped(adminScopedQueryFromMeta(st.meta, focus || fullTask))
          if (adminScoped) return adminScoped
        }
      }

      if (focus.length >= 4) {
        const okFocus = acceptScoped(focus)
        if (okFocus) return okFocus
        // 多子句时禁止把整段原话当作 focus 透传
        if (decompose && clauses.length > 1) {
          const bound = clauses.find((c) => c.agents?.includes(agent))
          if (bound?.text?.trim()) return bound.text.trim().slice(0, 480)
        }
        if (!decompose || clauses.length <= 1) return focus
      }

      const base =
        String(st.routedQuery || '').trim() || planHeuristicsFor(st) || String(fallback || '').trim()
      if (agent === 'db') {
        return resolveDbStepQuestionSync(base, lastUserText(st.messages), st.meta)
      }
      if (agent === 'admin') {
        const adminScoped = acceptScoped(adminScopedQueryFromMeta(st.meta, base))
        if (adminScoped) return adminScoped
      }
      if (isClauseDecomposeEnabled(deps.sessionId) && clauses.length > 1) {
        const scoped = acceptScoped(buildAgentScopedQuery(agent, clauses, base, st.meta))
        if (scoped) return scoped
      }
      if (clauses.length > 1 && isRepeatingUserTask(base, fullTask)) {
        const bound = clauses.find((c) => c.agents?.includes(agent))
        if (bound?.text?.trim()) return bound.text.trim().slice(0, 480)
      }
      return base
    }

    const formatBlueprintStepQuery = (agent: Step['agent'], queryFocus: string, st: any) => {
      const q = plannerQueryForAgent(agent, queryFocus, st)
      if (agent === 'rag') return `从知识库/文档查询相关原始数据并返回事实：${q}`
      if (agent === 'db') return `从数据库查询：${q}`
      if (agent === 'crawler') return `从公开网页采集与任务相关的事实信息：${q}`
      if (agent === 'gui') return `在浏览器中完成用户指定的页面交互与信息抽取：${q}`
      if (agent === 'clean') return `对已有数据进行清洗、去重、规范化与字段对齐：${q}`
      if (agent === 'code') return `对已有数据进行计算、加工和汇总，提取关键数值：${q}`
      if (agent === 'visualize') return `基于已有事实生成图表配置（ECharts option JSON）和表格数据：${q}`
      if (agent === 'report') return `整合多源结果生成结构化分析报告（核心结论、风险、建议）：${q}`
      return q
    }
  return { publishPlanUi, planHeuristicsFor, plannerQueryForAgent, formatBlueprintStepQuery }
}
