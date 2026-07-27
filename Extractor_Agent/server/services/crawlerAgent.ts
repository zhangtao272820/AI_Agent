import {
  buildStructuredTaskPlan,
  buildHeuristicPlan,
  detectCrawlerMissingSlotsSmart,
  detectTaskConflictsByLlm,
  isUnresolvedSeed,
  plannerWithLlm,
  createQwenChatModel,
  resolveRequestedLimit,
} from './crawlerAgentPlan'
import {
  decideExecutionStrategy,
  nowTs,
  pickUserAgent,
} from './crawlerAgentRouting'
import { buildTaskPreflight, detectTaskConflictsAndAmbiguity } from './crawlerAgentTaskPlanning'
import { runCrawlerWorkflow } from './crawlerAgentWorkflow'
import type { CrawlerAgentOptions, RunParams } from './crawlerAgentTypes'

export type { CrawlerAgentOptions } from './crawlerAgentTypes'
export { needsCrawlerClarifyStructural } from './crawlerAgentPlan'

function mergeManagerHintsIntoTaskPlan(
  taskPlan: Awaited<ReturnType<typeof buildStructuredTaskPlan>>,
  options?: CrawlerAgentOptions,
) {
  const hintFields = Array.isArray((options as any)?.hint_fields)
    ? (options as any).hint_fields.map((x: unknown) => String(x ?? '').trim()).filter(Boolean)
    : []
  const mustFilters = Array.isArray((options as any)?.must_filters)
    ? (options as any).must_filters.map((x: unknown) => String(x ?? '').trim()).filter(Boolean)
    : []
  const managerSeeds = Array.isArray((options as any)?.__managerSeedUrls)
    ? (options as any).__managerSeedUrls
    : []
  if (!hintFields.length && !mustFilters.length && !managerSeeds.length) return taskPlan
  let next = {
    ...taskPlan,
    ...(hintFields.length
      ? { fields: Array.from(new Set([...taskPlan.fields, ...hintFields])).slice(0, 12) }
      : {}),
    ...(mustFilters.length
      ? { filters: Array.from(new Set([...taskPlan.filters, ...mustFilters])).slice(0, 12) }
      : {}),
  }
  if (managerSeeds.length) {
    next = { ...next, openWebSearch: false }
  } else if ((options as any)?.__openWebDiscovery) {
    next = {
      ...next,
      openWebSearch: true,
      limit: next.limit != null && next.limit > 0 ? next.limit : 12,
      targetSite: next.targetSite === 'generic' ? 'generic' : next.targetSite,
      contentType: next.contentType === 'generic' ? 'generic' : next.contentType
    }
  }
  return next
}

export async function runCrawlerAgent(params: RunParams) {
  const injectBlocks = (params.options as any)?.__injectBlocks
  const taskPlan = mergeManagerHintsIntoTaskPlan(
    await buildStructuredTaskPlan(params.task, params.config, injectBlocks),
    params.options,
  )
  const heuristicPreview = buildHeuristicPlan(params.task, params.options, taskPlan)
  const previewSeed = String(heuristicPreview.seedUrls?.[0] ?? '').trim()
  if (isUnresolvedSeed(previewSeed) && taskPlan.targetSite === 'generic') {
    return {
      task: params.task,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'needs_clarification',
      clarify: {
        reason: 'unresolved_seed',
        missingSlots: ['source'],
        questions: ['未能定位可执行的数据来源，请提供目标网站/页面 URL，或明确站点名称。']
      },
      items: [],
      stats: {},
      taskPlan
    }
  }

  const llmConflict = await detectTaskConflictsByLlm(params.task, taskPlan, params.config)
  const conflictCheck =
    llmConflict.issues.length > 0
      ? llmConflict
      : detectTaskConflictsAndAmbiguity(params.task, taskPlan)
  const managerSeeds = Array.isArray((params.options as any)?.__managerSeedUrls)
    ? (params.options as any).__managerSeedUrls
    : []
  const preflight = buildTaskPreflight(params.task, taskPlan, managerSeeds)
  const inferredLimit = Number.isFinite(Number(taskPlan.limit)) ? Number(taskPlan.limit) : await resolveRequestedLimit(params.task, params.config)
  const preClarify = await detectCrawlerMissingSlotsSmart(params.task, params.config, {
    openWebSearch: Boolean(taskPlan.openWebSearch),
    fromManager: Boolean((params.options as any)?.__fromManager),
    inject: injectBlocks?.slot,
  })
  const canSkipLimitClarify = Number.isFinite(Number(taskPlan.limit)) && Number(taskPlan.limit) > 0
  const effectivePreClarify =
    preClarify && canSkipLimitClarify
      ? {
          ...preClarify,
          missingSlots: preClarify.missingSlots.filter((s) => s !== 'limit'),
          questions: preClarify.questions.filter((q) => !/抓取数量|top\s*20|前\s*10/i.test(String(q)))
        }
      : preClarify
  if (effectivePreClarify && effectivePreClarify.missingSlots.length > 0) {
    return {
      task: params.task,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'needs_clarification',
      clarify: {
        reason: 'missing_slots',
        missingSlots: effectivePreClarify.missingSlots,
        questions: effectivePreClarify.questions
      },
      items: [],
      stats: {},
      taskPlan,
      preflight
    }
  }
  if (conflictCheck.issues.length > 0) {
    return {
      task: params.task,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'needs_clarification',
      clarify: {
        reason: 'ambiguous_constraints',
        issues: conflictCheck.issues,
        questions: conflictCheck.questions
      },
      items: [],
      stats: {},
      taskPlan,
      preflight
    }
  }
  if (!preflight.executable) {
    return {
      task: params.task,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'needs_clarification',
      clarify: {
        reason: 'preflight_blocked',
        blockers: preflight.blockers,
        questions: preflight.suggestions
      },
      items: [],
      stats: {},
      taskPlan,
      preflight
    }
  }

  const emitLog = (level: 'info' | 'warn' | 'error', message: string) => {
    params.emit({ type: 'log', payload: { level, message, ts: nowTs() } })
  }
  const emitProgress = (stage: string, done?: number, total?: number) => {
    const payload: any = { stage }
    if (done != null) payload.done = done
    if (total != null) payload.total = total
    params.emit({ type: 'progress', payload })
  }

  return await runCrawlerWorkflow({
    task: params.task,
    options: (params.options ?? {}) as CrawlerAgentOptions,
    config: params.config,
    signal: params.signal,
    emitLog,
    emitProgress,
    taskPlan,
    inferredLimit: Number.isFinite(Number(inferredLimit)) ? Number(inferredLimit) : null,
    preflight,
    buildHeuristicPlan,
    plannerWithLlm,
    createQwenChatModel,
    pickUserAgent,
    decideExecutionStrategy
  })
}
