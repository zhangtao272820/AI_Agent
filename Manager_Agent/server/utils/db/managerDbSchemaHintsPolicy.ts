import { isDbAnchoredTaskText, isRagAnchoredTaskText, looksLikeSimpleRagKbQuery } from '../../graph/core/plan/clarifyContext'
import type { IntentClassifyResult } from '../../graph/llm/intentClassifyLlm'
import type { TaskConstraints } from '../../graph/core/plan'

export type DbSchemaHintsContext = {
  intentClassify?: Pick<IntentClassifyResult, 'isDbAnchored' | 'explicitWantsReport' | 'explicitWantsVisualize'> | null
  intent?: string
}

export type RagSchemaHintsContext = {
  intentClassify?: Pick<
    IntentClassifyResult,
    'primaryIntent' | 'isDbAnchored' | 'planShortcut' | 'explicitWantsReport' | 'explicitWantsVisualize'
  > | null
  intent?: string
}

/** 路由 LLM 常把「就诊记录/测试记录」误判为 wantsReport，结合意图识别节点纠正 */
export function coerceConstraintsForSimpleDbQuery(
  constraints: TaskConstraints,
  userMessage: string,
  ctx?: DbSchemaHintsContext
): TaskConstraints {
  const user = String(userMessage || '').trim()
  const anchored = isDbAnchoredTaskText(user, {
    intentClassify: ctx?.intentClassify,
    intent: ctx?.intent
  })
  if (!user || !anchored) return constraints

  const explicitReport = ctx?.intentClassify?.explicitWantsReport ?? constraints.wantsReport
  const explicitViz = ctx?.intentClassify?.explicitWantsVisualize ?? constraints.wantsVisualize
  const wantsReport = explicitReport ? constraints.wantsReport : false
  const wantsVisualize = explicitViz ? constraints.wantsVisualize : false
  if (wantsReport === constraints.wantsReport && wantsVisualize === constraints.wantsVisualize) return constraints
  return { ...constraints, wantsReport, wantsVisualize }
}

/** 路由 LLM 常把「查指标/测试数值」误判为 wantsReport，结合意图识别节点纠正 */
export function coerceConstraintsForSimpleRagQuery(
  constraints: TaskConstraints,
  userMessage: string,
  ctx?: RagSchemaHintsContext
): TaskConstraints {
  const user = String(userMessage || '').trim()
  const anchored = isRagAnchoredTaskText(user, {
    intentClassify: ctx?.intentClassify,
    intent: ctx?.intent
  })
  if (!user || !anchored) return constraints

  const explicitReport = ctx?.intentClassify?.explicitWantsReport ?? false
  const explicitViz = ctx?.intentClassify?.explicitWantsVisualize ?? false
  const wantsReport = explicitReport ? constraints.wantsReport : false
  const wantsVisualize = explicitViz ? constraints.wantsVisualize : false
  if (wantsReport === constraints.wantsReport && wantsVisualize === constraints.wantsVisualize) return constraints
  return { ...constraints, wantsReport, wantsVisualize }
}

export function shouldOmitManagerDbSchemaHints(input: {
  question?: string
  lastUser?: string
  meta?: unknown
  intent?: string
  intentClassify?: DbSchemaHintsContext['intentClassify']
}): boolean {
  const user = String(input.lastUser || input.question || '').trim()
  const meta = input.meta as { dbOnlyRoute?: boolean; dbOnlyShortcut?: boolean } | null | undefined
  const classify = input.intentClassify ?? (meta as { intentClassify?: DbSchemaHintsContext['intentClassify'] })?.intentClassify
  if (meta?.dbOnlyRoute || meta?.dbOnlyShortcut) return true
  if (String(input.intent || '').trim() === 'db') return true
  /** 复合流水线 db 步骤：schema 由 DB 自举，禁止总管 probe/prefetch 锁表 */
  if (String(input.intent || '').trim() === 'multi') return true
  if (!user || user.length > 280 || !isDbAnchoredTaskText(user, { intentClassify: classify, intent: input.intent })) {
    return false
  }
  const wantsReport = classify?.explicitWantsReport ?? false
  const wantsViz = classify?.explicitWantsVisualize ?? false
  if (wantsReport || wantsViz) return false
  return true
}
