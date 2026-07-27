import { z } from 'zod'
import type { BaseMessage } from '@langchain/core/messages'
import { routingConversationContext } from '../text'
import { shouldRunNlCoalesce } from '../routing/nlResolve'
import type { IntentClassifyResult, PlanShortcutKind } from '../../llm/intentClassifyLlm'
import type { TaskConstraints } from '../plan'

/** 会话级意图锚点：checkpoint 跨轮保留，供多轮承接参考（不含 cap 列表，禁止扩写 allowedAgents） */
export type SessionIntentAnchor = {
  primaryIntent: string
  primaryPlane: 'rag' | 'db' | 'crawler' | 'hybrid' | 'action' | 'chitchat' | 'unknown'
  planShortcut: PlanShortcutKind
  /** @deprecated 仅兼容旧 checkpoint；勿注入编排 prompt */
  suggestedAgents?: string[]
  isDbAnchored: boolean
  isMulti: boolean
  coalescedTask?: string
  /** 上轮实际执行的数据面 agent（rag/db/crawler），供 output_followup 窄 cap */
  lastExecutedAgents?: string[]
  updatedAt: string
}

export function sessionIntentAnchorFromMeta(meta: unknown): SessionIntentAnchor | null {
  const raw = (meta as { sessionIntentAnchor?: unknown } | null)?.sessionIntentAnchor
  if (!raw || typeof raw !== 'object') return null
  const a = raw as SessionIntentAnchor & { suggestedAgents?: string[] }
  if (!String(a.primaryIntent || '').trim()) return null
  const legacyAgents = Array.isArray(a.suggestedAgents) ? a.suggestedAgents : []
  const lastExecuted =
    a.lastExecutedAgents?.length
      ? a.lastExecutedAgents
      : legacyAgents.filter((x) => ['rag', 'db', 'crawler'].includes(String(x)))
  const primaryPlane =
    a.primaryPlane ??
    (lastExecuted.length >= 2
      ? 'hybrid'
      : lastExecuted[0] === 'rag' || lastExecuted[0] === 'db' || lastExecuted[0] === 'crawler'
        ? (lastExecuted[0] as SessionIntentAnchor['primaryPlane'])
        : a.isDbAnchored
          ? 'db'
          : 'unknown')
  return {
    ...a,
    primaryPlane,
    lastExecutedAgents: lastExecuted.length ? lastExecuted : undefined
  }
}

function primaryPlaneFromClassify(classify: IntentClassifyResult): SessionIntentAnchor['primaryPlane'] {
  const ds = classify.dataSources ?? []
  if (classify.needsAdmin) return 'action'
  if (ds.length >= 2) return 'hybrid'
  if (ds.includes('db')) return 'db'
  if (ds.includes('rag')) return 'rag'
  if (ds.includes('crawler')) return 'crawler'
  if (classify.planShortcut === 'chitchat_only') return 'chitchat'
  const pi = String(classify.primaryIntent || '')
  if (pi === 'admin' || pi === 'gui') return 'action'
  if (pi === 'rag' || pi === 'db' || pi === 'crawler') return pi as SessionIntentAnchor['primaryPlane']
  return 'unknown'
}

export function buildSessionIntentAnchor(
  classify: IntentClassifyResult,
  coalescedTask?: string,
  lastExecutedAgents?: string[]
): SessionIntentAnchor {
  const dataAgents = (lastExecutedAgents ?? classify.suggestedAgents ?? []).filter((a) =>
    ['rag', 'db', 'crawler'].includes(String(a))
  )
  return {
    primaryIntent: classify.primaryIntent,
    primaryPlane: primaryPlaneFromClassify(classify),
    planShortcut: classify.planShortcut,
    isDbAnchored: classify.isDbAnchored,
    isMulti: classify.isMulti,
    coalescedTask: coalescedTask ? String(coalescedTask).trim().slice(0, 880) : undefined,
    lastExecutedAgents: dataAgents.length ? [...new Set(dataAgents.map(String))] : undefined,
    updatedAt: new Date().toISOString()
  }
}

export function formatSessionAnchorBlock(anchor: SessionIntentAnchor | null | undefined): string {
  if (!anchor) return ''
  const exec = anchor.lastExecutedAgents?.length ? anchor.lastExecutedAgents.join('+') : ''
  return [
    '【上轮对话状态（任务摘要·不得据此扩 allowedAgents）】',
    `primaryPlane=${anchor.primaryPlane} intent=${anchor.primaryIntent} multi=${anchor.isMulti}`,
    exec ? `lastExecutedAgents=${exec}` : '',
    anchor.coalescedTask ? `task=${anchor.coalescedTask.slice(0, 200)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** 多轮场景下用于意图 RAG 的扩展问句（结构拼接，非承接词 regex） */
export function buildIntentRagQueryText(input: {
  messages: BaseMessage[]
  lastUser: string
  coalesced?: string
  sessionAnchor?: SessionIntentAnchor | null
}): { query: string; multiTurn: boolean } {
  const last = String(input.lastUser || '').trim()
  const coalesced = String(input.coalesced || '').trim()
  const multiTurn = shouldRunNlCoalesce(input.messages, last)

  if (coalesced.length >= 6) {
    return { query: coalesced.slice(0, 1200), multiTurn: true }
  }

  if (multiTurn) {
    const ctx = routingConversationContext(input.messages, { maxPriorRounds: 2, maxTotalChars: 720 })
    const anchor = input.sessionAnchor?.coalescedTask || ''
    const parts = [anchor, ctx, last].map((s) => String(s || '').trim()).filter(Boolean)
    return { query: parts.join('\n').slice(0, 1400), multiTurn: true }
  }

  if (input.sessionAnchor?.coalescedTask && last.length < 48 && shouldRunNlCoalesce(input.messages, last)) {
    return {
      query: `${input.sessionAnchor.coalescedTask}\n${last}`.slice(0, 1000),
      multiTurn: true
    }
  }

  return { query: last, multiTurn: false }
}

export function anchorBoostForRecall(
  hit: { primaryIntent: string; planShortcut: PlanShortcutKind; isDbAnchored: boolean },
  anchor: SessionIntentAnchor | null | undefined
): number {
  if (!anchor) return 0
  let boost = 0
  if (hit.primaryIntent === anchor.primaryIntent) boost += 0.05
  if (hit.planShortcut === anchor.planShortcut) boost += 0.04
  if (hit.isDbAnchored === anchor.isDbAnchored) boost += 0.02
  const exec = anchor.lastExecutedAgents ?? []
  if (exec.includes(hit.primaryIntent)) boost += 0.03
  return boost
}

export function constraintsFromMerged(
  raw: Partial<TaskConstraints> | null | undefined
): TaskConstraints {
  return {
    timeHints: Array.isArray(raw?.timeHints) ? raw!.timeHints!.map(String).filter(Boolean).slice(0, 4) : [],
    subjectHints: Array.isArray(raw?.subjectHints) ? raw!.subjectHints!.map(String).filter(Boolean).slice(0, 4) : [],
    fieldHints: Array.isArray(raw?.fieldHints) ? raw!.fieldHints!.map(String).filter(Boolean).slice(0, 6) : [],
    wantsVisualize: Boolean(raw?.wantsVisualize),
    wantsReport: Boolean(raw?.wantsReport)
  }
}
