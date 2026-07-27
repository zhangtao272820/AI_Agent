import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { extractManagerCoreQuestion, stripDbManagerPrefixes, stripPlanConstraintsFromQuery } from '#agent-shared/managerSubAgentProtocol'
import { normalizeEntities, type Intent, type Step, type TaskPlan } from '../../../utils/shared/taskPlan'
import { safeJsonParse } from '../shared/llmJson'
import type { TaskConstraints } from '../plan'
import { compositeMediaFromMeta, type CompositeMediaAgents } from '../../llm/mediaRouteLlm'
import { EMPTY_TASK_CONSTRAINTS } from '../../llm/taskConstraintsLlm'
import { resolveDbStepQuestionSync } from '../db/dbStepQuestion'
import { shouldRunNlCoalesce } from '../routing/nlResolve'

export function parseRagClarifyPayload(text: string): { needsClarify: boolean; questions: string[] } {
  const t = String(text ?? '').trim()
  if (!t) return { needsClarify: false, questions: [] }
  const marker = t.match(/<RAG_NEEDS_CLARIFY>([\s\S]*?)<\/RAG_NEEDS_CLARIFY>/i)
  if (marker) {
    const parsed = safeJsonParse(String(marker[1]).trim()) as any
    const flag = Boolean(parsed?.needsClarify || parsed?.needs_clarify)
    const questions = Array.isArray(parsed?.questions)
      ? parsed.questions.map((x: any) => String(x ?? '').trim()).filter(Boolean)
      : []
    return { needsClarify: flag || questions.length > 0, questions: questions.slice(0, 3) }
  }
  const jsonObj = safeJsonParse(t) as any
  if (jsonObj && typeof jsonObj === 'object') {
    const n = Boolean(jsonObj?.needsClarify || jsonObj?.needs_clarify)
    const q = Array.isArray(jsonObj?.questions)
      ? jsonObj.questions.map((x: any) => String(x ?? '').trim()).filter(Boolean)
      : []
    if (n || q.length) return { needsClarify: n || q.length > 0, questions: q.slice(0, 3) }
  }
  return { needsClarify: false, questions: [] }
}

export function parseCodeClarifyPayload(metaOrText: any): { needsClarify: boolean; questions: string[]; chips: string[] } {
  if (!metaOrText) return { needsClarify: false, questions: [], chips: [] }
  if (typeof metaOrText === 'object') {
    const needs = Boolean(metaOrText.needsClarify || metaOrText.needs_clarification)
    const questions = Array.isArray(metaOrText.clarifyQuestions)
      ? metaOrText.clarifyQuestions
      : Array.isArray(metaOrText.questions)
        ? metaOrText.questions
        : []
    const chips = Array.isArray(metaOrText.clarifyChips) ? metaOrText.clarifyChips : []
    return {
      needsClarify: needs || questions.length > 0,
      questions: questions.map((x: any) => String(x ?? '').trim()).filter(Boolean).slice(0, 4),
      chips: chips.map((x: any) => String(x ?? '').trim()).filter(Boolean).slice(0, 6),
    }
  }
  const t = String(metaOrText ?? '').trim()
  if (t.includes('【需要补充信息】')) {
    const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(1, 4)
    return { needsClarify: true, questions: lines, chips: [] }
  }
  return { needsClarify: false, questions: [], chips: [] }
}

export function parseCrawlerClarifyPayload(rawPayload: any): { needsClarify: boolean; questions: string[] } {
  const obj = rawPayload && typeof rawPayload === 'object' ? rawPayload : safeJsonParse(String(rawPayload ?? '').trim())
  const c = obj?.clarification
  if (!c || typeof c !== 'object') return { needsClarify: false, questions: [] }
  const hasUsableArrayData = ['items', 'results', 'data']
    .some((k) => Array.isArray(obj?.[k]) && obj[k].length > 0)
  const hasUsableNestedData =
    (obj?.payload && typeof obj.payload === 'object' && ['items', 'results', 'data'].some((k) => Array.isArray(obj.payload?.[k]) && obj.payload[k].length > 0)) ||
    (obj?.output && typeof obj.output === 'object' && ['items', 'results', 'data'].some((k) => Array.isArray(obj.output?.[k]) && obj.output[k].length > 0))
  if (hasUsableArrayData || hasUsableNestedData) return { needsClarify: false, questions: [] }
  const needs = Boolean(c.needsClarification || c.needsClarify)
  const qs = Array.isArray(c.questions) ? c.questions.map((x: any) => String(x ?? '').trim()).filter(Boolean) : []
  return { needsClarify: needs || qs.length > 0, questions: qs.slice(0, 4) }
}

export function crawlerTaskPlanPatch(rawPayload: any, fallbackQuery: string): Partial<TaskPlan> | null {
  const obj = rawPayload && typeof rawPayload === 'object' ? rawPayload : safeJsonParse(String(rawPayload ?? '').trim())
  const tp = obj?.taskPlan
  if (!tp || typeof tp !== 'object') return null
  const targetSite = String(tp.targetSite ?? '').trim()
  const contentType = String(tp.contentType ?? '').trim()
  const fields = Array.isArray(tp.fields) ? tp.fields.map((x: any) => String(x ?? '').trim()).filter(Boolean) : []
  const limit = Number(tp.limit)
  return {
    intent: 'crawler',
    entities: normalizeEntities({
      names: [],
      records: [contentType, ...fields, Number.isFinite(limit) && limit > 0 ? `limit:${Math.floor(limit)}` : ''].filter(Boolean),
      locations: [targetSite].filter(Boolean),
      dates: []
    } as any),
    steps: [{ agent: 'crawler', query: fallbackQuery }],
    needsClarification: false,
    clarificationQuestions: []
  }
}
