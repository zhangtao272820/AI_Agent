import { normalizeCodeOutputStructural } from '#agent-shared/codeAuthorityPayload'
import type { ManagerCodeTaskKind, TurnScopePayload } from '#agent-shared/managerTaskEnvelope'
import {
  extractStructuredPayload,
  safeJsonParse
} from '../../graph/core/shared'
import {
  resolveCleanPayloadFromResults,
  serializeCleanPayload
} from '#agent-shared/cleanPayload'
import { resolveManagerCodeTaskKind } from './resolveManagerCodeTaskKind'

export type StructuredUpstreamFact = {
  key: string
  value: unknown
  source?: string
  agent?: string
}

/** 与 Code_Assistent_Agent managerTask 字段对齐 */
export type ManagerCodeTaskPayload = {
  source: 'manager'
  task_kind: ManagerCodeTaskKind
  refined_question: string
  upstream_context?: string
  facts?: StructuredUpstreamFact[]
  hint_files?: string[]
  hint_symbols?: string[]
  must_outputs?: string[]
  risk_notes?: string[]
  write_allowed?: boolean
  turn_scope?: TurnScopePayload
}

const UPSTREAM_CONTEXT_AGENTS = ['rag', 'db', 'crawler', 'clean'] as const

function formatAgentUpstreamBlock(agent: string, raw: string, maxChars: number): string {
  const parsed = extractStructuredPayload(raw)
  const facts = (Array.isArray(parsed.facts) ? parsed.facts : [])
    .map((f) => ({ key: String(f?.key ?? '').trim(), value: f?.value }))
    .filter((f) => f.key)
    .slice(0, 20)
  const factLines = facts.map((f) => `  - ${f.key}：${String(f.value ?? '')}`).join('\n')
  const answer = String(parsed.answer || raw).replace(/\s+/g, ' ').trim()
  const excerpt = answer.length > maxChars ? `${answer.slice(0, maxChars)}…` : answer
  return [
    `${agent}:`,
    facts.length ? `结构化事实（须全部纳入 Code 输出，勿只保留其中一项）：\n${factLines}` : '结构化事实：未解析到（请阅读下方原文）',
    excerpt ? `原文摘要：${excerpt}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** 从上游 db/rag/crawler/clean 结果抽取结构化 facts[]（供 Code compute 直接消费） */
export function buildStructuredFactsFromResults(results?: Record<string, unknown> | null): StructuredUpstreamFact[] {
  if (!results || typeof results !== 'object') return []

  const cleanPayload = resolveCleanPayloadFromResults(results)
  if (cleanPayload?.facts?.length) {
    return cleanPayload.facts
      .map((f) => ({
        key: String(f.key ?? '').trim(),
        value: f.value,
        source: String(f.source ?? 'clean'),
        agent: 'clean' as const
      }))
      .filter((f) => f.key)
      .slice(0, 40)
  }

  const facts: StructuredUpstreamFact[] = []
  const seen = new Set<string>()
  for (const agent of UPSTREAM_CONTEXT_AGENTS) {
    const raw = String(results[agent] ?? '').trim()
    if (!raw) continue
    const parsed = extractStructuredPayload(raw)
    for (const f of Array.isArray(parsed.facts) ? parsed.facts : []) {
      const key = String(f?.key ?? '').trim()
      if (!key) continue
      const nk = key.toLowerCase()
      if (seen.has(nk)) continue
      seen.add(nk)
      facts.push({ key, value: f?.value, source: agent, agent })
    }
  }
  return facts.slice(0, 40)
}

export function buildUpstreamContextFromResults(results?: Record<string, unknown> | null): string {
  if (!results || typeof results !== 'object') return ''

  const cleanPayload = resolveCleanPayloadFromResults(results)
  if (cleanPayload) {
    const serialized = serializeCleanPayload(cleanPayload)
    const alignNote =
      cleanPayload.quality?.conflicts?.length
        ? `\n对齐冲突（须由 Code 裁决）：${cleanPayload.quality.conflicts
            .slice(0, 4)
            .map((c) => c.note)
            .join('；')}`
        : ''
    return [
      formatAgentUpstreamBlock('clean', serialized, 3200),
      alignNote
    ]
      .filter(Boolean)
      .join('\n')
  }

  const blocks: string[] = []
  for (const agent of UPSTREAM_CONTEXT_AGENTS) {
    const raw = String(results[agent] ?? '').trim()
    if (!raw) continue
    const max = agent === 'crawler' ? 1000 : agent === 'db' ? 4500 : 2000
    blocks.push(formatAgentUpstreamBlock(agent, raw, max))
  }
  const codeRaw = String(results.code ?? '').trim()
  if (codeRaw) blocks.push(formatAgentUpstreamBlock('code', codeRaw, 800))
  return blocks.join('\n\n')
}

function normFactKey(k: string) {
  return String(k ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

/** Code 只输出部分 facts 时，从 RAG/DB/爬虫 补全非计算类辅助事实（计算数字以 Code 为准） */
export function supplementCodeOutputFromUpstream(
  codeRaw: string,
  results: Record<string, unknown>
): string {
  const codeParsed = extractStructuredPayload(codeRaw)
  const have = new Set((codeParsed.facts || []).map((f) => normFactKey(String(f.key ?? ''))))
  const additions: Array<{ key: string; value: unknown; source: string }> = []

  for (const agent of ['rag', 'db', 'crawler'] as const) {
    const raw = String(results[agent] ?? '').trim()
    if (!raw) continue
    const parsed = extractStructuredPayload(raw)
    for (const f of parsed.facts || []) {
      const key = String(f?.key ?? '').trim()
      if (!key) continue
      const nk = normFactKey(key)
      if (have.has(nk)) continue
      have.add(nk)
      additions.push({ key, value: f.value, source: agent })
    }
  }
  if (!additions.length) return normalizeCodeOutputStructural(codeRaw, extractStructuredPayload)

  const mergedFacts = [
    ...(Array.isArray(codeParsed.facts) ? codeParsed.facts : []),
    ...additions.map((a) => ({ key: a.key, value: a.value, source: a.source }))
  ]
  const obj = safeJsonParse(codeRaw) as Record<string, unknown> | null
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    obj.facts = mergedFacts
    return normalizeCodeOutputStructural(JSON.stringify(obj), extractStructuredPayload)
  }

  const lines = additions.map((a) => `- ${a.key}：${String(a.value ?? '')}（${a.source}）`)
  return normalizeCodeOutputStructural(`${codeRaw.trim()}\n\n【上游补全事实】\n${lines.join('\n')}`, extractStructuredPayload)
}

/** @deprecated 使用 resolveManagerCodeTaskKind */
export function inferManagerCodeTaskKind(
  question: string,
  upstreamContext: string,
  meta?: unknown,
): ManagerCodeTaskPayload['task_kind'] {
  return resolveManagerCodeTaskKind({ question, upstreamContext, meta })
}

/**
 * 总管 → Code 的结构化载荷。
 * 有 upstream / hint / 非默认 task_kind 时返回对象；纯问句且无异构上下文时返回 null（仍可用 message 兼容）。
 */
const COMPUTE_GENERIC_DB_MUST_OUTPUTS = [
  '必须输出合法 JSON（含 answer、facts，可选 data）',
  'upstream_context 中 db/clean 的每条「字段：值」事实必须原样进入 facts，禁止编造、改写或遗漏数字',
  'answer 只能概括 facts 中已有字段，禁止引入 upstream 未出现的指标',
  '若与 upstream 冲突，以 db 原文为准；facts 的 source 填 db'
]

/** 有上游取数时：Code 输出为图表/报告/汇总的唯一权威数字源 */
const COMPUTE_UPSTREAM_MUST_OUTPUTS = [
  '必须输出合法 JSON（含 answer、facts、可选 data），下游 visualize/report 直接解析该 JSON',
  'upstream_context 中列出的每一条结构化事实都必须出现在 facts 中，禁止只摘录部分字段',
  'answer 与 facts、data 中的数字完全一致；answer 用 2～4 句说明全部关键数字与计算口径',
  'data 可含 echarts_option / chart_series 等图表结构，数字必须来自 facts，禁止编造',
  '若与上游 RAG/DB/爬虫 冲突，以本步 Code 为准，并在 answer 中一句话说明采信口径'
]

function formatFactsForUpstreamContext(facts: StructuredUpstreamFact[]): string {
  if (!facts.length) return ''
  const lines = facts.map((f) => `  - ${f.key}：${String(f.value ?? '')}（${f.agent || f.source || 'upstream'}）`)
  return `结构化事实（facts[]，须全部纳入 Code 输出）：\n${lines.join('\n')}`
}

export function buildManagerCodeTaskPayload(input: {
  question: string
  upstreamContext?: string
  facts?: StructuredUpstreamFact[]
  hintFiles?: string[]
  taskKind?: ManagerCodeTaskPayload['task_kind']
  meta?: unknown
  turnScope?: TurnScopePayload | null
}): ManagerCodeTaskPayload | null {
  const q = String(input.question ?? '').replace(/\s+/g, ' ').trim()
  if (!q) return null

  const facts = Array.isArray(input.facts) ? input.facts.slice(0, 32) : []
  const upstreamBase = String(input.upstreamContext ?? '').trim()
  const skipDupFacts =
    Boolean(upstreamBase) && facts.length > 0 && facts.every((f) => f.agent === 'clean' || f.source === 'clean')
  const factsBlock = skipDupFacts ? '' : formatFactsForUpstreamContext(facts)
  const upstream = [upstreamBase, factsBlock].filter(Boolean).join('\n\n').trim()
  const task_kind = resolveManagerCodeTaskKind({
    question: q,
    upstreamContext: upstream,
    explicitTaskKind: input.taskKind,
    meta: input.meta,
  })
  const hint_files = Array.isArray(input.hintFiles)
    ? input.hintFiles.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
    : []
  const computeWithUpstream = Boolean(upstream) && task_kind === 'compute'

  if (!upstream && !facts.length && !hint_files.length && task_kind === 'compute' && q.length < 80) {
    return null
  }

  const must_outputs = computeWithUpstream
    ? COMPUTE_UPSTREAM_MUST_OUTPUTS
    : undefined

  return {
    source: 'manager',
    task_kind: computeWithUpstream ? 'compute' : task_kind,
    refined_question: q.slice(0, 220),
    ...(upstream ? { upstream_context: upstream } : {}),
    ...(facts.length ? { facts } : {}),
    ...(hint_files.length ? { hint_files } : {}),
    ...(must_outputs?.length ? { must_outputs } : {}),
    write_allowed: task_kind === 'edit' || task_kind === 'script',
    ...(input.turnScope ? { turn_scope: input.turnScope } : {}),
  }
}

export function mergeManagerCodeTaskPayload(
  base: ManagerCodeTaskPayload | Record<string, unknown> | null | undefined,
  patch: Partial<ManagerCodeTaskPayload>,
): ManagerCodeTaskPayload {
  const prev = (base && typeof base === 'object' ? base : {}) as Partial<ManagerCodeTaskPayload>
  const refined = String(patch.refined_question ?? prev.refined_question ?? '').trim()
  const upstream = String(patch.upstream_context ?? prev.upstream_context ?? '').trim()
  const task_kind = patch.task_kind ?? prev.task_kind ?? resolveManagerCodeTaskKind({
    question: refined,
    upstreamContext: upstream,
  })
  const hintSet = new Set<string>([
    ...(Array.isArray(prev.hint_files) ? prev.hint_files : []),
    ...(Array.isArray(patch.hint_files) ? patch.hint_files : []),
  ].map((x) => String(x).trim()).filter(Boolean))

  return {
    source: 'manager',
    task_kind,
    refined_question: refined.slice(0, 220),
    ...(upstream ? { upstream_context: upstream } : {}),
    ...(hintSet.size ? { hint_files: [...hintSet].slice(0, 8) } : {}),
    write_allowed: patch.write_allowed ?? prev.write_allowed ?? task_kind === 'edit',
  }
}
