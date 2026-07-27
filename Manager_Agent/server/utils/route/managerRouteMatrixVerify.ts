/**
 * 路由矩阵 / 编排流水线离线门禁（L1 拓扑 + 结构性 lint，不调用 LLM）。
 * 供 verifyBeforePromote 与 smoke 脚本共用。
 */

import {
  buildTopologyBlueprintFromCap,
  blueprintCoversRequiredAgents,
  materializeStepsFromBlueprint
} from '../../graph/llm/planBlueprintLlm'
import { applyRoutePlanCoverage } from '../../graph/core/plan'
import { parseOrchestratorForTest } from '../../graph/llm/taskOrchestrator'
import { applyOrchestratorInvariants } from '../../graph/orchestrate/orchestratorInvariants'
import {
  lintOrchestratorBundle,
  orchestratorLintSeverity
} from '../../graph/orchestrate/orchestratorStructuralLint'
import { isOrchestratorLlmOnlyMode } from '../../graph/orchestrate/orchestratorPipeline'
import { isOrchestratorJudgeEnabled } from '../../graph/llm/orchestratorJudgeLlm'
import { isOrchestratorCompactFirst } from '../../graph/orchestrate/orchestratorHeuristic'

export type RouteMatrixVerifyCheck = { id: string; ok: boolean; detail?: string }

/** 八条黄金问句：给定 expectCap 后蓝图能否材料化（L1） */
export function verifyRouteMatrixTopologyCases(
  cases: Array<{
    id: string
    userTask: string
    expectCap: string[]
    expectPlanAgents: string[]
  }>
): RouteMatrixVerifyCheck[] {
  const checks: RouteMatrixVerifyCheck[] = []
  for (const c of cases) {
    try {
      const blueprint = buildTopologyBlueprintFromCap({
        allowedAgents: c.expectCap,
        userTask: c.userTask,
        constraints: {
          wantsVisualize: c.expectCap.includes('visualize'),
          wantsReport: c.expectCap.includes('report'),
          timeHints: [],
          subjectHints: [],
          fieldHints: []
        }
      })
      if (!blueprint?.steps?.length) {
        checks.push({ id: c.id, ok: false, detail: 'topology_blueprint_empty' })
        continue
      }
      if (!blueprintCoversRequiredAgents(blueprint, c.expectCap)) {
        checks.push({ id: c.id, ok: false, detail: 'blueprint_missing_cap_agents' })
        continue
      }
      const steps = materializeStepsFromBlueprint(blueprint, (agent, focus) => focus)
      const covered = applyRoutePlanCoverage(steps, {
        question: c.userTask,
        intent: 'multi',
        allowedCap: c.expectCap as any[],
        excerpt: c.userTask,
        constraints: {
          wantsVisualize: c.expectCap.includes('visualize'),
          wantsReport: c.expectCap.includes('report'),
          timeHints: [],
          subjectHints: [],
          fieldHints: []
        }
      })
      const have = new Set(covered.map((s) => s.agent))
      const missing = c.expectPlanAgents.filter((a) => !have.has(a as any))
      checks.push({
        id: c.id,
        ok: missing.length === 0,
        detail: missing.length ? `plan_missing:${missing.join(',')}` : 'ok'
      })
    } catch (e) {
      checks.push({
        id: c.id,
        ok: false,
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }
  return checks
}

/** 编排收敛期默认开关 + 结构性 lint 正反例（L1.5） */
export function verifyOrchestratorPipelineStructure(): RouteMatrixVerifyCheck[] {
  const checks: RouteMatrixVerifyCheck[] = [
    { id: 'llm_only_default', ok: isOrchestratorLlmOnlyMode() },
    { id: 'full_schema_first', ok: !isOrchestratorCompactFirst() },
    { id: 'judge_enabled', ok: isOrchestratorJudgeEnabled() }
  ]

  const simpleDbUser = '查询河西区70-79岁老人性别分布'
  const simpleRaw = {
    turnScopeMode: 'current_only' as const,
    directChitchatSynth: false,
    coalescedTask: simpleDbUser,
    clauses: [{ id: 'c1', text: simpleDbUser, agents: ['db'] as const }],
    dataSources: ['db'] as const,
    primaryIntent: 'db' as const,
    isMulti: false,
    suggestedAgents: ['db'] as const,
    isDbAnchored: true,
    needsWeb: false,
    explicitWantsVisualize: false,
    planShortcut: 'db_only' as const,
    requiresAgentPipeline: false,
    intent: 'db' as const,
    allowedAgents: ['db'] as const,
    routedQuery: simpleDbUser,
    needsWebSearch: false,
    confidence: 0.9,
    rationale: '单源DB'
  }

  try {
    const simpleBundle = parseOrchestratorForTest(simpleRaw)!
    const simpleDecision = applyOrchestratorInvariants({
      bundle: simpleBundle,
      turnScope: {
        mode: 'current_only',
        lastOnly: simpleDbUser,
        routingContext: simpleDbUser,
        suppressMultiTurnMerge: false,
        suppressSessionAnchor: false
      },
      state: { meta: {}, probe: { db: { matched: true, tables: ['person_info'] } } }
    })
    const simpleLint = lintOrchestratorBundle({
      userTask: simpleDbUser,
      allowedAgents: [...simpleDecision.allowedAgents],
      clauses: simpleDecision.clauses,
      classify: simpleDecision.intentClassify,
      planBlueprint: simpleDecision.planBlueprint
    })
    checks.push({
      id: 'simple_db_lint_ok',
      ok: orchestratorLintSeverity(simpleLint) === 'ok',
      detail: simpleLint.slice(0, 2).join(';') || 'ok'
    })
  } catch (e) {
    checks.push({
      id: 'simple_db_lint_ok',
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  const compoundUser =
    '知识库查养老机构服务规范要点，数据库查老人总数和性别分布，再从公开网站查2025年养老行业平均床位费参考，汇总对比并出图。'

  try {
    const badCompound = parseOrchestratorForTest({
      turnScopeMode: 'current_only',
      clauses: [{ id: 'c1', text: compoundUser, agents: ['db', 'crawler'] }],
      dataSources: ['db', 'crawler'],
      primaryIntent: 'multi',
      isMulti: true,
      suggestedAgents: ['db', 'crawler', 'clean', 'code', 'visualize'],
      isDbAnchored: true,
      needsWeb: true,
      explicitWantsVisualize: true,
      planShortcut: 'none',
      requiresAgentPipeline: true,
      intent: 'multi',
      allowedAgents: ['db', 'crawler', 'clean', 'code', 'visualize'],
      routedQuery: compoundUser,
      needsWebSearch: true,
      planBlueprint: {
        rationale: 'bad',
        steps: [
          { agent: 'db', queryFocus: compoundUser },
          { agent: 'crawler', queryFocus: compoundUser },
          { agent: 'clean', queryFocus: compoundUser },
          { agent: 'code', queryFocus: compoundUser },
          { agent: 'visualize', queryFocus: compoundUser }
        ],
        confidence: 0.7
      },
      confidence: 0.7,
      rationale: '未拆子句'
    })!
    const badLint = lintOrchestratorBundle({
      userTask: compoundUser,
      allowedAgents: [...badCompound.allowedAgents],
      clauses: badCompound.clauses,
      classify: badCompound.intentClassify,
      planBlueprint: badCompound.planBlueprint
    })
    checks.push({
      id: 'bad_compound_lint_fail',
      ok: orchestratorLintSeverity(badLint) === 'fail',
      detail: badLint.slice(0, 2).join(';') || 'no_issues'
    })
  } catch (e) {
    checks.push({
      id: 'bad_compound_lint_fail',
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  try {
    const spuriousLint = lintOrchestratorBundle({
      userTask: '查询河西区70-79岁老人性别分布',
      allowedAgents: ['db', 'report'],
      clauses: [{ id: 'c1', text: '查询河西区70-79岁老人性别分布', agents: ['db'] }],
      classify: {
        dataSources: ['db'],
        planShortcut: 'db_only',
        requiresAgentPipeline: false,
        confidence: 0.9,
        rationale: 'db'
      } as any,
      planBlueprint: {
        rationale: 'x',
        steps: [{ agent: 'db', queryFocus: '性别分布' }],
        confidence: 0.9
      }
    })
    checks.push({
      id: 'spurious_report_lint_warn',
      ok: spuriousLint.some((i) => i.includes('report')) && orchestratorLintSeverity(spuriousLint) === 'warn',
      detail: spuriousLint.join(';') || 'no_issues'
    })
  } catch (e) {
    checks.push({
      id: 'spurious_report_lint_warn',
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  return checks
}
