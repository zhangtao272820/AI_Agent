import type { Step } from '../../../utils/shared/taskPlan'
import { ALL_PLAN_AGENTS, buildTaskPlan, trimBloatedPlan, applyRoutePlanCoverage, normalizePlanSteps, materializeMissingRouteAgents } from '../../core/plan'
import { pipelineHintsFromMeta } from '../../llm/pipelineHintsLlm'
import { effectiveUserTask } from '../../core/text'
import { lintPlanWithPlannerRules, loadActivePlannerRules } from '../../core/evolution/plannerRules'
import { EMPTY_TASK_CONSTRAINTS, taskConstraintsFromMeta } from '../../llm/taskConstraintsLlm'
import { clausesFromMeta } from '../../core/routing/clauses'
import { validateAndPreparePlan } from '../../core/plan/planValidate'
import {
  lintClausePlanCoverage,
  mergePlanWithClauseMaterialization
} from '../../core/routing/clausePlanBinding'
import { planBlueprintFromMeta } from '../../llm/planBlueprintLlm'
import { repairMissingPlanStepsByLlm } from '../../llm/planRepairLlm'
import { repairPlanWebAgentMismatchByLlm } from '../../llm/planWebAgentAlignLlm'
import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'
import { shouldSuppressPlanLinterClarify } from '../../core/plan/clarifySuppress'


import type { CreatePlanLinterNodeDeps } from './types'

export function createPlanLinterNode(deps: CreatePlanLinterNodeDeps) {
  const { ensureNotAborted, policyDir, opts, getEffectivePlanSteps, lastUserText, buildClarifyQuestions, mergeMeta, llmInvoke } = deps

  return async (state: any) => {
    ensureNotAborted()
    opts.sendEvent({ event: 'phase', data: 'plan_lint', from: 'manager' })

    const steps = getEffectivePlanSteps(state as any)
    const issues: string[] = []

    if (!Array.isArray(steps) || steps.length === 0) issues.push('计划为空：没有可执行步骤')
    if (Array.isArray(steps) && steps.length > 8) issues.push(`步骤过多：${steps.length}（建议 <= 8）`)

    const ids = new Set<string>()
    for (const s of Array.isArray(steps) ? steps : []) {
      const id = String((s as any)?.id || '').trim()
      const agent = String((s as any)?.agent || '').trim()
      const query = String((s as any)?.query || '').trim()
      if (!id) issues.push(`存在缺失 id 的步骤（agent=${agent || 'unknown'}）`)
      else {
        if (ids.has(id)) issues.push(`步骤 id 重复：${id}`)
        ids.add(id)
      }
      if (!ALL_PLAN_AGENTS.includes(agent as any)) issues.push(`步骤 agent 非法：${agent || '(empty)'}`)
      if (!query) issues.push(`步骤 query 为空（id=${id || 'unknown'}）`)

      const deps = Array.isArray((s as any)?.dependsOn) ? (s as any).dependsOn : []
      for (const d of deps) {
        const depId = String(d || '').trim()
        if (!depId) continue
        if (id && depId === id) issues.push(`步骤自依赖：${id}`)
      }
    }

    const explicitAgents = new Set<string>(Array.isArray(state.allowedAgents) ? state.allowedAgents : [])
    if (state.intent === 'multi' && explicitAgents.size > 0) {
      for (const s of Array.isArray(steps) ? steps : []) {
        const id = String((s as any)?.id || '').trim()
        const agent = String((s as any)?.agent || '').trim()
        if (!agent) continue
        if (!explicitAgents.has(agent)) {
          const isImplicitCollab = ['code', 'visualize', 'report', 'clean'].includes(agent)
          const dataPipelineRequested = ['db', 'rag', 'crawler'].some((a) => explicitAgents.has(a))
          if (isImplicitCollab && dataPipelineRequested) continue
          issues.push(`步骤越权：${id || 'unknown'} 使用了未在路由 allowedAgents 中授权的 agent=${agent}`)
        }
      }
      if (!explicitAgents.has('db')) {
        const hasDbStep = (Array.isArray(steps) ? steps : []).some((s: any) => String(s?.agent || '') === 'db')
        if (hasDbStep) issues.push('步骤越权：route 未明确要求 db，但计划中出现了 db 步骤')
      }
    }
    for (const s of Array.isArray(steps) ? steps : []) {
      const id = String((s as any)?.id || '').trim()
      const deps = Array.isArray((s as any)?.dependsOn) ? (s as any).dependsOn : []
      for (const d of deps) {
        const depId = String(d || '').trim()
        if (depId && !ids.has(depId)) issues.push(`依赖不存在：${id || 'unknown'} dependsOn ${depId}`)
      }
    }

    /**
     * entities 在图状态里是跨轮累积的（reducer 合并），不能把旧话题的人名/记录强加到新问题上。
     * 仅当姓名或记录仍出现在「末轮用户话」或「路由改写」中时，才参与关键实体校验。
     */
    const lastQ = lastUserText(state.messages as any)
    const routedQ = String(state.routedQuery ?? '').trim()
    const taskText = effectiveUserTask(state.messages as any, state.routedQuery)
    const entityScopeText = [lastQ, routedQ].filter(Boolean).join('\n')
    const namesRaw = Array.isArray(state.entities?.names) ? state.entities.names.filter(Boolean) : []
    const names = namesRaw.filter((n: string) => n && entityScopeText.includes(n))
    const recordsRaw = Array.isArray(state.entities?.records) ? state.entities.records.filter(Boolean) : []
    const records = recordsRaw.filter((r: string) => r && entityScopeText.includes(r))
    const stepsArr = Array.isArray(steps) ? steps : []
    const byId = new Map<string, any>(stepsArr.map((s: any) => [String(s?.id || '').trim(), s]).filter(([k]) => k))

    /** 直接上游步骤的 query 拼接后是否已包含全部 hint（姓名/记录/约束词），避免 rag/db/code 等重复粘贴同一实体被误伤 */
    const directUpstreamQueriesCoverAll = (s: any, hints: string[]): boolean => {
      if (!hints.length) return false
      const deps = Array.isArray(s?.dependsOn) ? s.dependsOn : []
      if (!deps.length) return false
      const blob = deps
        .map((d: any) => byId.get(String(d || '').trim()))
        .filter(Boolean)
        .map((u: any) => String(u?.query || ''))
        .join('\n')
      if (!blob.trim()) return false
      return hints.every((h) => h && blob.includes(h))
    }

    const dbStepsCarryingNames =
      names.length > 0
        ? stepsArr.filter(
            (x: any) =>
              String(x?.agent || '') === 'db' && names.every((n: string) => n && String(x?.query || '').includes(n))
          )
        : []

    if (names.length) {
      /** 合成/公开检索类不要求重复人名；有 DB 步骤承载姓名时下游可不重复粘贴 */
      const stepNeedsPersonLiteral = (s: any): boolean => {
        const agent = String(s?.agent || '')
        if (['report', 'visualize', 'clean', 'admin', 'crawler'].includes(agent)) return false
        if (directUpstreamQueriesCoverAll(s, names)) return false
        if (dbStepsCarryingNames.length > 0 && ['rag', 'code'].includes(agent)) {
          const deps = Array.isArray(s?.dependsOn) ? s.dependsOn.map((d: any) => String(d || '').trim()) : []
          const linkedToDb =
            deps.length === 0 ||
            deps.some((depId) => dbStepsCarryingNames.some((db) => String(db?.id || '').trim() === depId))
          if (linkedToDb) return false
        }
        return true
      }
      for (const s of stepsArr) {
        if (!stepNeedsPersonLiteral(s)) continue
        const id = String((s as any)?.id || '').trim()
        const q = String((s as any)?.query || '')
        const hasAny = names.some((n: string) => n && q.includes(n))
        if (!hasAny) issues.push(`关键实体丢失：步骤 ${id || 'unknown'} 的 query 未包含姓名(${names.join('、')})`)
      }
    }
    if (records.length) {
      for (const s of stepsArr) {
        const agent = String((s as any)?.agent || '')
        if (agent !== 'db') continue
        if (directUpstreamQueriesCoverAll(s, records)) continue
        const id = String((s as any)?.id || '').trim()
        const q = String((s as any)?.query || '')
        const hasAny = records.some((r: string) => r && q.includes(r))
        if (!hasAny) issues.push(`关键实体丢失：DB 步骤 ${id || 'unknown'} 的 query 未包含业务记录(${records.join('、')})`)
      }
    }
    const constraints = taskConstraintsFromMeta(state.meta) ?? { ...EMPTY_TASK_CONSTRAINTS }
    if (constraints.timeHints.length) {
      const adminSteps = (Array.isArray(steps) ? steps : []).filter(
        (s: any) => String(s?.agent || '') === 'admin'
      )
      const adminCoversTime =
        adminSteps.length > 0 &&
        adminSteps.some((s: any) => {
          const q = String(s?.query || '')
          return constraints.timeHints.some((h) => h && q.includes(h))
        })
      const dataSteps = (Array.isArray(steps) ? steps : []).filter((s: any) =>
        ['db', 'rag', 'code', 'crawler'].includes(String(s?.agent || ''))
      )
      if (!adminCoversTime) {
        const missingAllTime = dataSteps.filter((s: any) => {
          if (directUpstreamQueriesCoverAll(s, constraints.timeHints)) return false
          const q = String(s?.query || '')
          return !constraints.timeHints.some((h) => q.includes(h))
        })
        if (missingAllTime.length === dataSteps.length && dataSteps.length > 0) {
          issues.push(`时间口径丢失：数据步骤未保留时间约束(${constraints.timeHints.join('、')})`)
        }
      }
    }
    if (constraints.subjectHints.length) {
      const dataSteps = (Array.isArray(steps) ? steps : []).filter((s: any) => ['db', 'rag', 'code', 'crawler'].includes(String(s?.agent || '')))
      const missingAllSubject = dataSteps.filter((s: any) => {
        if (directUpstreamQueriesCoverAll(s, constraints.subjectHints)) return false
        const q = String(s?.query || '')
        return !constraints.subjectHints.some((h) => q.includes(h))
      })
      if (missingAllSubject.length === dataSteps.length && dataSteps.length > 0) {
        issues.push(`对象约束丢失：数据步骤未保留对象约束(${constraints.subjectHints.join('、')})`)
      }
    }

    const allowedSet = new Set(
      (Array.isArray(state.allowedAgents) ? state.allowedAgents : []).map((a: any) => String(a ?? '').trim())
    )
    let lintSteps = Array.isArray(steps) ? [...steps] : []
    const clauses = clausesFromMeta(state.meta)
    const pipelineHints = pipelineHintsFromMeta(state.meta)

    const webAligned = await repairPlanWebAgentMismatchByLlm({
      userTask: taskText,
      plan: lintSteps,
      meta: state.meta,
      llmInvoke,
      state
    })
    if (webAligned?.length) {
      lintSteps = normalizePlanSteps(webAligned)
      opts.sendEvent({
        event: 'thinking',
        data: `计划校验：启发模型将误配的 crawler/gui 步骤对齐 → ${lintSteps.map((s) => s.agent).join(' → ')}`,
        from: 'manager'
      })
    }

    const applyClauseBindingRepair = (): boolean => {
      if (state.intent !== 'multi' || clauses.length <= 1 || allowedSet.size === 0) return false
      const cap = [...allowedSet] as any[]
      const clauseIssuesBefore = lintClausePlanCoverage(clauses, lintSteps, {
        excerpt: taskText,
        allowedAgents: cap
      })
      if (!clauseIssuesBefore.length) return false
      const bound = mergePlanWithClauseMaterialization(lintSteps, clauses, {
        excerpt: taskText,
        fallbackQuery: taskText,
        allowedAgents: cap,
        meta: state.meta as Record<string, unknown>
      })
      if (bound.repaired || bound.issuesAfter.length < clauseIssuesBefore.length) {
        lintSteps = normalizePlanSteps(
          validateAndPreparePlan(bound.plan, {
            excerpt: taskText,
            pipelineOpts: { question: taskText, constraints, pipelineHints },
            allowedCap: cap
          })
        )
        if (!state.meta?.lowCostMode) {
          opts.sendEvent({
            event: 'thinking',
            data: `子句绑定修复：${bound.reasons.join('；') || '已补全遗漏子句'} → ${lintSteps.map((s) => s.agent).join(' → ')}`,
            from: 'manager'
          })
        }
      }
      if (bound.issuesAfter.length) {
        issues.push(...bound.issuesAfter)
      }
      return bound.repaired || bound.issuesAfter.length < clauseIssuesBefore.length
    }

    applyClauseBindingRepair()

    if (state.intent === 'multi' && allowedSet.size > 0) {
      const presentInLint = new Set(
        lintSteps.map((s) => String(s?.agent || '').trim()).filter(Boolean)
      )
      const missingRouteAgents = [...allowedSet].filter((a) => !presentInLint.has(a))
      if (missingRouteAgents.length) {
        const repaired = applyRoutePlanCoverage(lintSteps, {
          question: taskText,
          intent: state.intent,
          allowedCap: [...allowedSet] as any[],
          excerpt: taskText,
          constraints,
          pipelineHints
        })
        const repairedAgents = new Set(
          repaired.map((s) => String(s?.agent || '').trim()).filter(Boolean)
        )
        const stillMissing = [...allowedSet].filter((a) => !repairedAgents.has(a))
        if (!stillMissing.length) {
          lintSteps = normalizePlanSteps(repaired)
          applyClauseBindingRepair()
          opts.sendEvent({
            event: 'thinking',
            data: `计划校验：已自动补全路由遗漏步骤 → ${lintSteps.map((s) => s.agent).join(' → ')}`,
            from: 'manager'
          })
          return {
            plan: lintSteps,
            taskPlan: buildTaskPlan(state, lintSteps),
            meta: mergeMeta(state, { planLintOk: true, planLintIssues: [], planCoverageRepaired: true })
          }
        }
        const forceMaterialized = materializeMissingRouteAgents(lintSteps, {
          allowedCap: [...allowedSet] as Step['agent'][],
          excerpt: taskText,
          meta: state.meta as Record<string, unknown>
        })
        const forceRepaired = applyRoutePlanCoverage(forceMaterialized, {
          question: taskText,
          intent: state.intent,
          allowedCap: [...allowedSet] as any[],
          excerpt: taskText,
          constraints,
          pipelineHints
        })
        const forceAgents = new Set(
          forceRepaired.map((s) => String(s?.agent || '').trim()).filter(Boolean)
        )
        const forceStillMissing = [...allowedSet].filter((a) => !forceAgents.has(a))
        if (forceStillMissing.length) {
          const llmRepaired = await repairMissingPlanStepsByLlm({
            missingAgents: forceStillMissing as Step['agent'][],
            existingPlan: forceRepaired,
            userTask: taskText,
            allowedAgents: [...allowedSet],
            clauses: clausesFromMeta(state.meta),
            planBlueprint: planBlueprintFromMeta(state.meta),
            llmInvoke,
            state
          })
          if (llmRepaired?.length) {
            const merged = applyRoutePlanCoverage([...forceRepaired, ...llmRepaired], {
              question: taskText,
              intent: state.intent,
              allowedCap: [...allowedSet] as any[],
              excerpt: taskText,
              constraints,
              pipelineHints
            })
            const mergedAgents = new Set(
              merged.map((s) => String(s?.agent || '').trim()).filter(Boolean)
            )
            const llmStillMissing = [...allowedSet].filter((a) => !mergedAgents.has(a))
            if (!llmStillMissing.length) {
              lintSteps = normalizePlanSteps(merged)
              applyClauseBindingRepair()
              opts.sendEvent({
                event: 'thinking',
                data: `计划校验：启发模型补全遗漏步骤 → ${lintSteps.map((s) => s.agent).join(' → ')}`,
                from: 'manager'
              })
              return {
                plan: lintSteps,
                taskPlan: buildTaskPlan(state, lintSteps),
                meta: mergeMeta(state, { planLintOk: true, planLintIssues: [], planCoverageRepaired: true, planRepairLlm: true })
              }
            }
          }
        }
        if (!forceStillMissing.length) {
          lintSteps = normalizePlanSteps(forceRepaired)
          applyClauseBindingRepair()
          opts.sendEvent({
            event: 'thinking',
            data: `计划校验：已强制补全路由 cap 步骤 → ${lintSteps.map((s) => s.agent).join(' → ')}`,
            from: 'manager'
          })
          return {
            plan: lintSteps,
            taskPlan: buildTaskPlan(state, lintSteps),
            meta: mergeMeta(state, { planLintOk: true, planLintIssues: [], planCoverageRepaired: true })
          }
        }
        issues.push(`规划遗漏：route allowedAgents 含 ${missingRouteAgents.join('/')} 但计划中未生成对应步骤`)
      }
    }

    const plannerRules = await loadActivePlannerRules(policyDir).catch(() => null)
    const ruleIssues = lintPlanWithPlannerRules(state, steps, plannerRules)
    if (ruleIssues.length) {
      issues.push(...ruleIssues)
      if (!state.meta?.lowCostMode) {
        opts.sendEvent({
          event: 'thinking',
          data: `规划硬规则：${ruleIssues.slice(0, 3).join('；')}`,
          from: 'manager'
        })
      }
    }

    if (issues.length) {
      const routeSaysRag = String(state.intent || '').trim() === 'rag'
      const softOnly =
        routeSaysRag &&
        issues.every((i) => {
          const s = String(i || '')
          return s.includes('时间口径丢失') || s.includes('对象约束丢失')
        })
      const entityOnlyIssues = issues.filter((i) => String(i || '').includes('关键实体丢失'))
      const blockingIssues = issues.filter((i) => !String(i || '').includes('关键实体丢失'))
      const entitySoftPass =
        entityOnlyIssues.length > 0 &&
        blockingIssues.length === 0 &&
        dbStepsCarryingNames.length > 0 &&
        entityOnlyIssues.every((i) => !/DB 步骤/.test(String(i || '')))
      if (softOnly || entitySoftPass) {
        opts.sendEvent({
          event: 'thinking',
          data: entitySoftPass
            ? `计划校验：姓名已由 DB 步骤承载，下游检索/合成未重复人名视为通过（${issues.slice(0, 4).join('；')}）`
            : `计划校验：知识库任务下时间与对象口径提示已降为非阻断（${issues.slice(0, 4).join('；')}）`,
          from: 'manager'
        })
        return { meta: mergeMeta(state, { planLintOk: true, planLintIssues: issues.slice(0, 12) }) }
      }
      const qs = buildClarifyQuestions(taskText, state.intent, state.probe, {
        planIssues: issues,
        entityNames: names,
        constraints
      })
      if (shouldSuppressPlanLinterClarify(state.meta)) {
        opts.sendEvent({
          event: 'thinking',
          data: `计划校验：编排已判定无需澄清（${String((state.meta as { turnKind?: string })?.turnKind || 'turnKind')}/${String((state.meta as { clarifyKind?: string })?.clarifyKind || 'clarify')}），继续执行`,
          from: 'manager'
        })
        return {
          meta: mergeMeta(state, {
            planLintOk: true,
            planLintIssues: issues.slice(0, 12),
            needsClarify: false,
            clarifyQuestions: []
          })
        }
      }
      if (!qs.length) {
        opts.sendEvent({
          event: 'thinking',
          data: `计划校验：${issues.slice(0, 4).join('；')}（已具备对象标识，无需澄清，继续执行）`,
          from: 'manager'
        })
        return {
          meta: mergeMeta(state, {
            planLintOk: true,
            planLintIssues: issues.slice(0, 12),
            needsClarify: false,
            clarifyQuestions: []
          })
        }
      }
      const meta = mergeMeta(state, {
        planLintOk: false,
        planLintIssues: issues.slice(0, 12),
        needsClarify: true,
        clarifyQuestions: qs
      })
      opts.sendEvent({ event: 'thinking', data: `计划校验未通过：${issues.slice(0, 4).join('；')}`, from: 'manager' })
      return { meta }
    }

    const trim = trimBloatedPlan(Array.isArray(steps) ? steps : [], {
      question: taskText,
      constraints,
      pipelineHints
    })
    if (trim.changed && trim.reasons.length) {
      opts.sendEvent({
        event: 'thinking',
        data: `计划瘦身：${trim.reasons.join('；')}（${steps.length}→${trim.steps.length} 步）`,
        from: 'manager'
      })
      return {
        plan: trim.steps,
        taskPlan: buildTaskPlan(state, trim.steps),
        meta: mergeMeta(state, { planLintOk: true, planLintIssues: [], planTrimmed: true })
      }
    }
    return { meta: mergeMeta(state, { planLintOk: true, planLintIssues: [] }) }
  }
}

