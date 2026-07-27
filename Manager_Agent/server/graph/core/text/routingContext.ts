import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { extractManagerCoreQuestion, stripDbManagerPrefixes, stripPlanConstraintsFromQuery } from '#agent-shared/managerSubAgentProtocol'
import { normalizeEntities, type Intent, type Step, type TaskPlan } from '../../../utils/shared/taskPlan'
import { safeJsonParse } from '../shared/llmJson'
import type { TaskConstraints } from '../plan'
import { compositeMediaFromMeta, type CompositeMediaAgents } from '../../llm/mediaRouteLlm'
import { EMPTY_TASK_CONSTRAINTS } from '../../llm/taskConstraintsLlm'
import { resolveDbStepQuestionSync } from '../db/dbStepQuestion'
import { shouldRunNlCoalesce } from '../routing/nlResolve'

export function lastUserText(messages: BaseMessage[]) {
  const last = [...messages].reverse().find((m) => m instanceof HumanMessage) as HumanMessage | undefined
  return String(last?.content ?? '').trim()
}

/** 用户是否在单条输入里用多行写了多条独立需求（结构检测，不依赖编号样式正则）。 */
export function hasStructuralMultiLineBullets(text: string): boolean {
  const raw = String(text || '').trim()
  if (!raw.includes('\n')) return false
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 8)
  return lines.length >= 2
}

/** 结构性 multi 信号：多行独立需求（不含关键词表） */
export function isExplicitMultiRequest(text: string) {
  return hasStructuralMultiLineBullets(String(text || ''))
}

/**
 * 当前轮是否为「单行、非并列」的新任务：路由/拆解/规划仅用末句，避免上一轮收支/图表等污染本轮（如纯音乐生成）。
 * 参考 Semantic Router / Rasa conversation boundaries：默认隔离，仅短承接句走 continuation。
 */
export function preferCurrentTurnScope(messages: BaseMessage[], lastOnly?: string): boolean {
  const list = Array.isArray(messages) ? messages : []
  const texts = list
    .filter((m) => m instanceof HumanMessage)
    .map((m) => String((m as HumanMessage).content ?? '').trim())
    .filter(Boolean)
  const last = String(lastOnly ?? texts[texts.length - 1] ?? '').trim()
  if (!last) return false
  if (texts.length <= 1) return true
  if (hasStructuralMultiLineBullets(last)) return false
  if (isExplicitMultiRequest(last)) return false
  if (shouldRunNlCoalesce(list, last)) return false
  return true
}

/**
 * 路由/规划启发式用：默认仅末轮；多轮且需承接时用有限历史（由 preferCurrentTurnScope 决定）。
 */
export function routingHeuristicsUserText(messages: BaseMessage[]): string {
  const list = Array.isArray(messages) ? messages : []
  const texts = list
    .filter((m) => m instanceof HumanMessage)
    .map((m) => String((m as HumanMessage).content ?? '').trim())
    .filter(Boolean)
  if (!texts.length) return ''
  const last = texts[texts.length - 1]!
  if (texts.length === 1 || preferCurrentTurnScope(messages, last)) return last
  return routingConversationContext(messages, { maxPriorRounds: 1, maxTotalChars: 960 })
}

/**
 * 路由/探测用：拼接最近若干轮用户发言，缓解多轮指代丢失。
 * 单轮时与 lastUserText 等价。
 */
export function routingConversationContext(messages: BaseMessage[], options?: { maxPriorRounds?: number; maxTotalChars?: number }) {
  const maxPrior = options?.maxPriorRounds ?? 3
  const maxTotal = options?.maxTotalChars ?? 2400
  const list = Array.isArray(messages) ? messages : []
  const texts = list
    .filter((m) => m instanceof HumanMessage)
    .map((m) => String((m as HumanMessage).content ?? '').trim())
    .filter(Boolean)
  if (!texts.length) return ''
  const last = texts[texts.length - 1]
  if (texts.length === 1) return last.length > maxTotal ? `${last.slice(0, maxTotal)}…` : last
  const prior = texts.slice(0, -1).slice(-maxPrior)
  const priorBlock = prior.map((t, i) => `【第${i + 1}轮】${t}`).join('\n')
  const header = '【对话上下文】\n'
  const cur = '\n\n【当前用户输入】\n'
  let combined = `${header}${priorBlock}${cur}${last}`
  if (combined.length > maxTotal) {
    const reserve = Math.min(800, Math.floor(maxTotal * 0.35))
    const lastPart = `${cur}${last}`
    const headBudget = Math.max(120, maxTotal - reserve - header.length)
    const trimmedPrior =
      priorBlock.length > headBudget ? `…（前序省略）\n${priorBlock.slice(-headBudget)}` : priorBlock
    combined = `${header}${trimmedPrior}${lastPart}`
    if (combined.length > maxTotal) combined = `${combined.slice(0, maxTotal)}…`
  }
  return combined.trim()
}

/** 已有路由改写时用语义任务串；否则用多轮上下文 */
export function effectiveUserTask(messages: BaseMessage[], routedQuery?: string | null) {
  const r = String(routedQuery ?? '').trim()
  if (r) return r
  return routingConversationContext(messages)
}
