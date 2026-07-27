import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { extractManagerCoreQuestion, stripDbManagerPrefixes, stripPlanConstraintsFromQuery } from '#agent-shared/managerSubAgentProtocol'
import { normalizeEntities, type Intent, type Step, type TaskPlan } from '../../../utils/shared/taskPlan'
import { safeJsonParse } from '../shared/llmJson'
import type { TaskConstraints } from '../plan'
import { compositeMediaFromMeta, type CompositeMediaAgents } from '../../llm/mediaRouteLlm'
import { EMPTY_TASK_CONSTRAINTS } from '../../llm/taskConstraintsLlm'
import { resolveDbStepQuestionSync } from '../db/dbStepQuestion'
import { shouldRunNlCoalesce } from '../routing/nlResolve'

/** @deprecated 请用 resolveTaskConstraints / extractTaskConstraintsByLlm；同步路径返回空约束 */
export function extractTaskConstraints(_text: string): TaskConstraints {
  return { ...EMPTY_TASK_CONSTRAINTS }
}

export function appendConstraintsToQuery(
  query: string,
  constraints: { timeHints: string[]; subjectHints: string[] }
) {
  const base = String(query ?? '').trim()
  if (!base) return base
  const extras: string[] = []
  if (constraints.timeHints.length && !constraints.timeHints.some((x) => base.includes(x))) {
    extras.push(`保留时间口径：${constraints.timeHints.join('、')}`)
  }
  if (constraints.subjectHints.length && !constraints.subjectHints.some((x) => base.includes(x))) {
    extras.push(`保留对象约束：${constraints.subjectHints.join('、')}`)
  }
  if (!extras.length) return base
  return `${base}\n\n约束：${extras.join('；')}`
}

/**
 * 从「保留对象约束」候选里去掉 RAG/财务文档类碎片，只保留可与结构化库查询共存的短对象词（如人名）。
 */
export function filterSubjectHintsForDbAgent(hints: string[], head: string): string[] {
  const h = String(head ?? '').trim()
  return hints
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .filter((s) => s.length <= 32 && (h.includes(s) || /^[\u4e00-\u9fa5]{2,8}$/.test(s)))
    .slice(0, 4)
}

/**
 * 去掉或重写 `\n\n约束：` 段里对 DB 有害的「保留对象约束」，保留时间口径等。
 */
export function sanitizeConstraintBlockForDbAgent(query: string): string {
  const s = String(query ?? '').trim()
  const marker = '\n\n约束：'
  const idx = s.indexOf(marker)
  if (idx === -1) return s
  const head = s.slice(0, idx).trim()
  const rest = s.slice(idx + marker.length).trim()
  const segments = rest.split(/[；;]/).map((x) => x.trim()).filter(Boolean)
  const kept: string[] = []
  for (const seg of segments) {
    if (!seg.startsWith('保留对象约束')) {
      kept.push(seg)
      continue
    }
    const body = seg.replace(/^保留对象约束[：:]\s*/i, '').trim()
    const hints = body.split(/、|，|,/).map((x) => x.trim()).filter(Boolean)
    const ok = filterSubjectHintsForDbAgent(hints, head)
    if (ok.length) kept.push(`保留对象约束：${ok.join('、')}`)
  }
  return kept.length ? `${head}${marker}${kept.join('；')}` : head
}

/** 仅对 DB 步骤追加约束：对象约束经 filter，避免把知识库/月收入等混进库查询。 */
export function appendConstraintsToDbAgentQuery(
  query: string,
  constraints: { timeHints: string[]; subjectHints: string[] },
) {
  const base = sanitizeConstraintBlockForDbAgent(String(query ?? '').trim())
  const extras: string[] = []
  if (constraints.timeHints.length && !constraints.timeHints.some((x) => base.includes(x))) {
    extras.push(`保留时间口径：${constraints.timeHints.join('、')}`)
  }
  const filtered = filterSubjectHintsForDbAgent(constraints.subjectHints, base)
  if (filtered.length && !filtered.some((x) => base.includes(x))) {
    extras.push(`保留对象约束：${filtered.join('、')}`)
  }
  if (!extras.length) return base
  return `${base}\n\n约束：${extras.join('；')}`
}

/**
 * 生成传给 DB_Agent 的短问句：去掉总管模板前缀、混源约束；若正文仍含明显知识库/财务检索用语而末轮用户句干净，则退回末轮原话。
 */
const DB_QUESTION_PREFIXES = [
  '从数据库查询相关记录并返回结构化结果：',
  '从数据库查询相关记录并返回结构化结果:',
  '从数据库查询相关记录：',
  '从数据库查询相关记录:',
  '从数据库查询：',
  '从数据库查询:',
  '在数据库中查询：',
  '在数据库中查询:',
  '在数据库中查询 ',
] as const

function stripDbQuestionTemplatePrefix(q: string): string {
  let s = String(q ?? '').trim()
  for (const p of DB_QUESTION_PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length).trim()
      break
    }
  }
  if (s.endsWith('，并生成报告')) s = s.slice(0, -'，并生成报告'.length).trim()
  else if (s.endsWith(',并生成报告')) s = s.slice(0, -',并生成报告'.length).trim()
  else if (s.endsWith('并生成报告')) s = s.slice(0, -'并生成报告'.length).replace(/[，,]\s*$/, '').trim()
  return s
}

export function resolveLeanDbUserQuestion(stepOrRouted: string, lastUserMessage: string, meta?: unknown): string {
  return resolveDbStepQuestionSync(stepOrRouted, lastUserMessage, meta)
}
