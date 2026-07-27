/**
 * Verify 层：图跑完后的质量评估与通道重试（browser → cloud，MCP 预算受控）。
 */
import { ensureBrowser } from '../fetch/runtime'
import { isCloudScrapeConfigured } from '../fetch/cloudScrape'
import { channelTraceHas, canInvokeMcp } from '../fetch/mcpBudget'
import { shouldCloudScrapeQualityRetry, scoreQualityRun } from '../plan/structural'
import type { StructuredTaskPlan } from '../../services/crawlerAgentTaskPlanning'
import { getCapabilityProfile } from '../../services/capabilityRegistry'
import { evaluateCrawlRun, resolveMinItems, type CrawlEvalResult } from './qualityGate'

export type VerifierEmitLog = (level: 'info' | 'warn' | 'error', message: string) => void

export type VerifierRetryResult = {
  evalResult: CrawlEvalResult
  selectedState: any
  retryMeta: Record<string, unknown>
}

export async function runVerifierRetries(input: {
  graph: { invoke: (init: any) => Promise<any> }
  task: string
  config: any
  taskPlan: StructuredTaskPlan
  inferredLimit: number | null
  mergedOptions: Record<string, any>
  finalState: any
  emitLog: VerifierEmitLog
}): Promise<VerifierRetryResult> {
  const { graph, task, config, taskPlan, inferredLimit, mergedOptions, finalState, emitLog } = input
  const evaluateRun = (state: any, attempt: number) =>
    evaluateCrawlRun({ state, taskPlan, inferredLimit, attempt })

  let evalResult = evaluateRun(finalState, 1)
  if (evalResult.quality.builtinPass) {
    emitLog('info', `Verifier：榜单核心字段已满足（${evalResult.itemsAfterPlan.length} 条），无需通道重试`)
  }
  let selectedState = finalState
  const retryMeta: Record<string, unknown> = {
    triggered: false,
    reasonCodes: [],
    selectedAttempt: 1,
    selectedBy: 'first_run',
    retryChannel: 'none',
  }

  let browserAlreadyTried =
    Boolean(mergedOptions.useBrowser) ||
    channelTraceHas(mergedOptions, 'browser') ||
    Boolean(mergedOptions.__qualityBrowserRetryDone)

  const minItemsForScore = evalResult.quality.minItems ?? resolveMinItems(taskPlan, inferredLimit)
  const requestedLimitForScore = (() => {
    const fromPlan = Number(taskPlan?.limit)
    if (Number.isFinite(fromPlan) && fromPlan > 0) return Math.floor(fromPlan)
    if (Number.isFinite(Number(inferredLimit)) && Number(inferredLimit) > 0) return Math.floor(Number(inferredLimit))
    return null
  })()
  const scoreRun = (ev: CrawlEvalResult) =>
    scoreQualityRun({
      fieldCoverage: ev.quality.fieldCoverage,
      dupRate: ev.quality.dupRate,
      itemCount: ev.itemsAfterPlan.length,
      requestedLimit: requestedLimitForScore,
      minItems: minItemsForScore,
    })

  const preferMcp = Boolean(mergedOptions.__preferMcp)
  const mcpBudgetLeft = canInvokeMcp(mergedOptions)
  const siteProfile = getCapabilityProfile(taskPlan.targetSite as any, taskPlan.contentType as any)
  const preferChannel =
    (mergedOptions.preferred_channel as 'http' | 'browser' | 'mcp' | undefined) ||
    siteProfile?.preferChannel
  const builtinHandler = siteProfile?.builtinHandler ?? null
  // HTTP 优先内置榜单：禁止整图云抓取重试（根因在补丁抽取，不是通道）
  const skipCloudQualityRetry =
    preferChannel === 'http' && Boolean(String(builtinHandler ?? '').trim()) && !preferMcp

  if (
    !evalResult.quality.passed &&
    preferMcp &&
    !skipCloudQualityRetry &&
    isCloudScrapeConfigured(config) &&
    !mergedOptions.__qualityCloudRetryDone &&
    mcpBudgetLeft
  ) {
    retryMeta.triggered = true
    retryMeta.reasonCodes = [...new Set([...(retryMeta.reasonCodes as string[]), ...evalResult.retryReasons])]
    emitLog('warn', 'Verifier：云抓取优先任务质量未达标，触发云抓取通道重试')
    const cloudRetryOptions = {
      ...mergedOptions,
      useBrowser: false,
      __preferMcp: true,
      __qualityCloudRetryDone: true,
      __retryAttempt: 2,
    }
    delete (cloudRetryOptions as any).resumeId
    const cloudState = await graph.invoke({ task, options: cloudRetryOptions })
    const cloudEval = evaluateRun(cloudState, 2)
    retryMeta.firstScore = scoreRun(evalResult)
    retryMeta.cloudScore = scoreRun(cloudEval)
    if (cloudEval.quality.passed || (retryMeta.cloudScore as number) > (retryMeta.firstScore as number)) {
      selectedState = cloudState
      evalResult = cloudEval
      retryMeta.selectedAttempt = cloudEval.attempt
      retryMeta.selectedBy = cloudEval.quality.passed ? 'cloud_scrape_passed' : 'cloud_scrape_better_score'
      retryMeta.retryChannel = 'mcp'
      emitLog('info', `Verifier：已采用云抓取重试结果（attempt=${cloudEval.attempt}）`)
    }
  }

  if (!evalResult.quality.passed && !browserAlreadyTried && !Boolean(mergedOptions.__qualityBrowserRetryDone)) {
    retryMeta.triggered = true
    retryMeta.reasonCodes = [...evalResult.retryReasons]
    const retryHeadless = mergedOptions.headless ?? true
    let browserReady = true
    try {
      await ensureBrowser(Boolean(retryHeadless))
    } catch (e: any) {
      browserReady = false
      emitLog('warn', `Verifier：浏览器环境不可用，跳过二次浏览器重试：${String(e?.message ?? e ?? '').slice(0, 120)}`)
    }
    if (browserReady) {
      emitLog('warn', 'Verifier：首次结果质量未达标，触发二次抓取（浏览器优先）')
      browserAlreadyTried = true
      const retryOptions = { ...mergedOptions, useBrowser: true, __qualityBrowserRetryDone: true, __retryAttempt: 2 }
      delete (retryOptions as any).resumeId
      const retryState = await graph.invoke({ task, options: retryOptions })
      const retryEval = evaluateRun(retryState, 2)
      retryMeta.firstScore = scoreRun(evalResult)
      retryMeta.retryScore = scoreRun(retryEval)
      if (retryEval.quality.passed || (retryMeta.retryScore as number) > (retryMeta.firstScore as number)) {
        selectedState = retryState
        evalResult = retryEval
        retryMeta.selectedAttempt = retryEval.attempt
        retryMeta.selectedBy = retryEval.quality.passed ? 'retry_passed' : 'retry_better_score'
        retryMeta.retryChannel = 'browser'
        emitLog('info', `Verifier：已采用二次抓取结果（attempt=${retryEval.attempt}）`)
      } else {
        emitLog('info', 'Verifier：二次抓取未优于首次结果，保留首次结果')
      }
    }
  } else if (!evalResult.quality.passed && browserAlreadyTried) {
    emitLog('info', 'Verifier：本轮已尝试过浏览器通道，跳过二次浏览器重试')
  }

  const allowCloudRetry =
    !skipCloudQualityRetry &&
    shouldCloudScrapeQualityRetry({
      targetSite: taskPlan.targetSite,
      contentType: taskPlan.contentType,
      browserAlreadyTried,
      preferMcp: Boolean(mergedOptions.__preferMcp),
      preferChannel,
      builtinHandler,
    })

  if (
    !evalResult.quality.passed &&
    isCloudScrapeConfigured(config) &&
    !mergedOptions.__qualityCloudRetryDone &&
    allowCloudRetry &&
    canInvokeMcp(mergedOptions) &&
    !preferMcp
  ) {
    retryMeta.triggered = true
    retryMeta.reasonCodes = [...new Set([...(retryMeta.reasonCodes as string[]), ...evalResult.retryReasons])]
    emitLog('warn', 'Verifier：质量未达标，尝试云抓取通道重试（HTTP/浏览器已成功但抽取不足）')
    const cloudRetryOptions = {
      ...mergedOptions,
      useBrowser: false,
      __preferMcp: true,
      __qualityCloudRetryDone: true,
      __retryAttempt: 3,
    }
    delete (cloudRetryOptions as any).resumeId
    const cloudState = await graph.invoke({ task, options: cloudRetryOptions })
    const cloudEval = evaluateRun(cloudState, 3)
    retryMeta.firstScore = scoreRun(evalResult)
    retryMeta.cloudScore = scoreRun(cloudEval)
    if (cloudEval.quality.passed || (retryMeta.cloudScore as number) > (retryMeta.firstScore as number)) {
      selectedState = cloudState
      evalResult = cloudEval
      retryMeta.selectedAttempt = cloudEval.attempt
      retryMeta.selectedBy = cloudEval.quality.passed ? 'cloud_scrape_passed' : 'cloud_scrape_better_score'
      retryMeta.retryChannel = 'mcp'
      emitLog('info', `Verifier：已采用云抓取重试结果（attempt=${cloudEval.attempt}）`)
    }
  } else if (!canInvokeMcp(mergedOptions) && !evalResult.quality.passed) {
    emitLog('warn', 'Verifier：云抓取额度已用尽且仍无有效数据，跳过重试以节省额度')
  }

  return { evalResult, selectedState, retryMeta }
}
