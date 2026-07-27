
import type { CreateResourceNodeDeps } from './types'


export function createResourceNode(deps: CreateResourceNodeDeps) {
  const { opts, readEnvNumber, mergeResources, mergeMeta } = deps

  return async (state: any) => {
    opts.sendEvent({ event: 'phase', data: 'resource', from: 'manager' })
    const startedAtMs = Date.now()
    const deadlineAtMs = startedAtMs + Math.max(2_000, Number(opts.timeoutMs || 60_000))
    const profile = opts.llmProfile
    const modelRoute = String(profile?.modelRoute || process.env.MANAGER_MODEL_ROUTE || opts.openaiModel).trim()
    const modelRouteMax = String(
      profile?.modelRouteMax || process.env.MANAGER_MODEL_ROUTE_MAX || modelRoute || opts.openaiModel
    ).trim()
    const modelPlan = String(profile?.modelPlan || process.env.MANAGER_MODEL_PLAN || opts.openaiModel).trim()
    const modelSynth = String(profile?.modelSynth || process.env.MANAGER_MODEL_SYNTH || opts.openaiModel).trim()
    const modelCritic = String(profile?.modelCritic || process.env.MANAGER_MODEL_CRITIC || opts.openaiModel).trim()
    const modelVerifier = String(
      profile?.modelVerifier || process.env.MANAGER_MODEL_VERIFIER || modelCritic || opts.openaiModel
    ).trim()
    const modelLowCost = String(
      profile?.modelLowCost || process.env.MANAGER_MODEL_LOW_COST || process.env.MANAGER_MODEL_ROUTE || opts.openaiModel
    ).trim()
    const modelClean = String(process.env.MANAGER_MODEL_CLEAN || modelLowCost || opts.openaiModel).trim()
    const modelVisualize = String(process.env.MANAGER_MODEL_VISUALIZE || modelLowCost || opts.openaiModel).trim()
    const modelReport = String(process.env.MANAGER_MODEL_REPORT || modelLowCost || opts.openaiModel).trim()
    const budgetUsd = readEnvNumber('MANAGER_BUDGET_USD')
    const budgetTokens = readEnvNumber('MANAGER_BUDGET_TOKENS')
    const costPer1kTokensUsd = readEnvNumber('MANAGER_COST_PER_1K_TOKENS_USD', 0) ?? 0
    const resources = mergeResources(state, {
      startedAtMs,
      deadlineAtMs,
      budgetUsd,
      budgetTokens,
      usedUsd: 0,
      usedTokens: 0,
      modelRoute,
      modelRouteMax,
      modelPlan,
      modelSynth,
      modelCritic,
      modelVerifier,
      modelLowCost,
      modelClean,
      modelVisualize,
      modelReport,
      costPer1kTokensUsd
    })
    const workbenchMode = (() => {
      const m = state?.meta && typeof state.meta === 'object' ? (state.meta as Record<string, unknown>) : {}
      const raw = String(m.interactionMode ?? m.workbenchMode ?? '').trim().toLowerCase()
      if (raw === 'professional' || raw === 'pro') return 'professional'
      if (raw === 'chat' || raw === 'dialog') return 'chat'
      return 'chat'
    })()
    const meta = mergeMeta(state, {
      lowCostMode: false,
      uncertainty: 'medium',
      capabilityOk: true,
      needsClarify: false,
      clarifyQuestions: [],
      interactionMode: workbenchMode,
      workbenchMode
    })
    const budgetLine =
      typeof budgetUsd === 'number' || typeof budgetTokens === 'number'
        ? `预算：${typeof budgetUsd === 'number' ? `$${budgetUsd}` : '∞'} / ${typeof budgetTokens === 'number' ? `${budgetTokens} tokens` : '∞'}`
        : '预算：未设置'
    opts.sendEvent({ event: 'thinking', data: `资源感知：${budgetLine}，deadline=${Math.round((deadlineAtMs - startedAtMs) / 1000)}s`, from: 'manager' })
    return { resources, meta }
  }
}

