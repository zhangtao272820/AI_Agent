import type { Step } from '../../../utils/shared/taskPlan'
import { estimateMultiEtaMs } from '../../core/runtime/stepStatus'
import {
  getManagerMaxParallel,
  isParallelIndependentEnabled,
  suggestMaxParallelForPlan
} from '../../core/plan/planParallel'

import type { CreateSchedulerNodeDeps } from './types'


export function createSchedulerNode(deps: CreateSchedulerNodeDeps) {
  const { opts, getEffectivePlanSteps } = deps
  return async (state: any) => {
    opts.sendEvent({ event: 'phase', data: 'scheduler', from: 'manager' })
    const steps = getEffectivePlanSteps(state as any)
    const agents = steps.map((s: any) => String(s?.agent || ''))
    const hasHeavy = agents.some((a) => a === 'report' || a === 'visualize')
    const dataFanIn = agents.filter((a) => a === 'rag' || a === 'db' || a === 'crawler').length
    const envCap = getManagerMaxParallel()
    const planSuggested = suggestMaxParallelForPlan(steps)
    let maxParallel = isParallelIndependentEnabled()
      ? Math.max(1, planSuggested)
      : steps.length >= 5
        ? 2
        : steps.length >= 3
          ? 3
          : 4
    if (!isParallelIndependentEnabled() && dataFanIn >= 2) {
      const fanInMin = Number(process.env.MANAGER_DATA_FANIN_MIN_PARALLEL ?? 2)
      const floor = Number.isFinite(fanInMin) && fanInMin >= 2 ? Math.min(envCap, Math.floor(fanInMin)) : 2
      maxParallel = Math.max(maxParallel, Math.min(envCap, dataFanIn, floor))
    }
    if (isParallelIndependentEnabled() && dataFanIn >= 2) {
      const fanInMin = Number(process.env.MANAGER_DATA_FANIN_MIN_PARALLEL ?? 2)
      const floor = Number.isFinite(fanInMin) && fanInMin >= 2 ? Math.min(envCap, Math.floor(fanInMin)) : 2
      maxParallel = Math.max(maxParallel, Math.min(envCap, dataFanIn, floor))
    }
    maxParallel = Math.min(envCap, Math.max(1, maxParallel))
    let timeoutScale = hasHeavy ? 1.25 : dataFanIn >= 2 ? 1.15 : 1
    const healthAgents = Array.isArray(state?.toolHealth?.agents) ? state.toolHealth.agents : []
    const byAgent = new Map<string, { status: string; p95Ms: number }>()
    for (const h of healthAgents) {
      const a = String(h?.agent || '').trim()
      if (!a) continue
      byAgent.set(a, { status: String(h?.status || 'unknown'), p95Ms: Number(h?.p95Ms || 0) })
    }
    const downAgents = Array.from(byAgent.entries())
      .filter(([id, v]) => {
        if (v.status !== 'down') return false
        // db/rag 曾有成功耗时记录时，不因探测 alone 在调度层 skip（与 tool_health 降级策略一致）
        if ((id === 'db' || id === 'rag') && v.p95Ms > 0) return false
        return true
      })
      .map(([k]) => k)
    const degradedAgents = Array.from(byAgent.entries())
      .filter(([, v]) => v.status === 'degraded')
      .map(([k]) => k)
    if (degradedAgents.length > 0) {
      maxParallel = Math.max(1, maxParallel - 1)
      timeoutScale = Math.min(1.6, timeoutScale + 0.15)
    }
    if (downAgents.length > 0) {
      maxParallel = Math.max(1, maxParallel - 1)
    }
    // 独立并行开启时：不因 degraded 把双取数并行压回 1（截图中 planParallel=2 却 maxParallel=1）
    if (isParallelIndependentEnabled() && dataFanIn >= 2) {
      const fanInMin = Number(process.env.MANAGER_DATA_FANIN_MIN_PARALLEL ?? 2)
      const floor = Number.isFinite(fanInMin) && fanInMin >= 2 ? Math.min(envCap, Math.floor(fanInMin)) : 2
      maxParallel = Math.max(maxParallel, Math.min(envCap, planSuggested, dataFanIn, floor))
    }
    const agentTimeoutScale: Record<string, number> = {}
    const stepAgents = Array.from(new Set(agents))
    for (const agent of stepAgents) {
      const h = byAgent.get(agent)
      if (!h) continue
      const p95 = Number(h.p95Ms || 0)
      let per = 1
      if (h.status === 'degraded') per += 0.25
      if (p95 >= 40_000) per += 0.25
      else if (p95 >= 22_000) per += 0.15
      else if (p95 >= 12_000) per += 0.08
      agentTimeoutScale[agent] = Math.max(0.9, Math.min(1.9, Number(per.toFixed(2))))
    }
    const skipAgents = downAgents.filter((a) => stepAgents.includes(a))
    const circuitOpenAgents = Array.from(new Set([...skipAgents]))
    const circuitOpenUnique = circuitOpenAgents
    const degradeOptionalAgents = degradedAgents.filter((a) => ['visualize', 'report', 'clean', 'crawler'].includes(a))
    const healthSummary = `degraded=${degradedAgents.join('/') || 'none'}, down=${downAgents.join('/') || 'none'}`
    const contextBudget = {
      rag: dataFanIn >= 2 ? 900 : 1200,
      db: dataFanIn >= 2 ? 900 : 1200,
      crawler: dataFanIn >= 2 ? 800 : 1000,
      code: hasHeavy ? 700 : 900,
      clean: 700,
      visualize: hasHeavy ? 900 : 1100,
      report: hasHeavy ? 1200 : 1500
    }
    const reason = `steps=${steps.length}, dataFanIn=${dataFanIn}, heavy=${hasHeavy ? 'yes' : 'no'}, health=${healthSummary}, planParallel=${planSuggested}, cap=${envCap}`
    const etaMs = estimateMultiEtaMs({ totalSteps: steps.length, completedSteps: 0, maxParallel, timeoutScale })
    opts.sendEvent({
      event: 'thinking',
      data: `调度策略：maxParallel=${maxParallel}${dataFanIn >= 2 || planSuggested >= 2 ? ' (独立Agent并行)' : ''}, timeoutScale=${timeoutScale.toFixed(2)}, 预估剩余≈${Math.round(etaMs / 1000)}s, skip=${skipAgents.join('/') || 'none'}, circuit=${circuitOpenUnique.join('/') || 'none'}, contextBudget(report=${contextBudget.report}) (${reason})`,
      from: 'manager'
    })
    opts.sendEvent({
      event: 'step_status',
      data: {
        stepId: '_scheduler',
        agent: 'manager',
        status: 'running',
        pct: 0,
        eta_ms: etaMs
      },
      from: 'manager'
    })
    return {
      scheduler: {
        maxParallel,
        timeoutScale,
        contextBudget,
        skipAgents,
        agentTimeoutScale,
        circuitOpenAgents: circuitOpenUnique,
        degradeOptionalAgents,
        healthSummary,
        reason,
        generatedAt: new Date().toISOString()
      }
    }
  }
}


