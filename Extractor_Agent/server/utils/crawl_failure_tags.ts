/**
 * 采集失败归因标签：HTTP 状态码结构性判定 + 可选 LLM 语义分类。
 */
import type { ChatOpenAI } from '@langchain/openai'
import type { CrawlChannel } from './crawl_metrics'
import { classifyFailReasonStructural, isCrawlFailureLlmEnabled, resolveFailReason } from './crawlFailureLlm'

export type CrawlFailureTag =
  | 'captcha_or_block'
  | 'auth_required'
  | 'forbidden'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'browser_missing'
  | 'empty_dom'
  | 'wrong_channel'
  | 'low_coverage'
  | 'high_dup'
  | 'low_count'
  | 'unknown'

const HTTP_BLOCK_MARKERS = ['http 403', 'http 401', 'http 429', '403', '429', 'forbidden', 'access denied'] as const

/** HTTP 403/429 或反爬拦截（结构性状态码/英文片段） */
export function isHttpBlockedError(msg: string): boolean {
  const m = String(msg ?? '').toLowerCase()
  return HTTP_BLOCK_MARKERS.some((x) => m.includes(x)) || m.includes('captcha_or_block')
}

/** 同步分类：结构性兜底；完整语义分类请用 resolveFailReason（LLM） */
export function classifyFailReason(msg: string): CrawlFailureTag {
  const structural = classifyFailReasonStructural(msg)
  if (structural !== 'unknown') return structural
  const m = String(msg || '').toLowerCase()
  if (m.includes('captcha') || m.includes('verify you are human') || m.includes('challenge')) {
    return 'captcha_or_block'
  }
  return 'unknown'
}

export function inferFailureTagsFromRun(result: any): CrawlFailureTag[] {
  const tags = new Set<CrawlFailureTag>()
  const events = Array.isArray(result?.stats?._events) ? result.stats._events : []
  for (const e of events) {
    if (e?.status === 'error' && e?.reason) {
      tags.add(classifyFailReason(String(e.reason)))
    }
  }
  const retry = result?.retry
  if (Array.isArray(retry?.reasonCodes)) {
    for (const r of retry.reasonCodes) {
      if (r === 'low_coverage') tags.add('low_coverage')
      if (r === 'high_dup') tags.add('high_dup')
      if (r === 'low_count') tags.add('low_count')
    }
  }
  const items = Array.isArray(result?.items) ? result.items : []
  if (items.length === 0 && String(result?.status ?? '') !== 'needs_clarification') {
    tags.add('empty_dom')
  }
  if (retry?.triggered && !result?.quality?.passed) {
    tags.add('wrong_channel')
  }
  return [...tags]
}

/** LLM 增强：对仍为 unknown 的事件做语义分类（需 EXTRACTOR_FAILURE_LLM=1） */
export async function inferFailureTagsFromRunAsync(
  result: any,
  model: ChatOpenAI | null,
): Promise<CrawlFailureTag[]> {
  const tags = new Set(inferFailureTagsFromRun(result))
  if (!isCrawlFailureLlmEnabled() || !model) return [...tags]
  const events = Array.isArray(result?.stats?._events) ? result.stats._events : []
  for (const e of events) {
    if (e?.status !== 'error') continue
    const msg = String(e?.reason ?? '').trim()
    if (!msg) continue
    const structural = classifyFailReasonStructural(msg)
    if (structural !== 'unknown') {
      tags.add(structural)
      continue
    }
    if (tags.has('unknown')) {
      const resolved = await resolveFailReason(model, msg)
      if (resolved !== 'unknown') tags.add(resolved)
    }
  }
  return [...tags]
}

export function primaryFailureTag(tags: CrawlFailureTag[]): CrawlFailureTag | null {
  const priority: CrawlFailureTag[] = [
    'captcha_or_block',
    'auth_required',
    'forbidden',
    'rate_limited',
    'wrong_channel',
    'empty_dom',
    'low_coverage',
    'low_count',
    'high_dup',
    'timeout',
    'network',
    'browser_missing',
    'unknown',
  ]
  for (const p of priority) {
    if (tags.includes(p)) return p
  }
  return tags[0] ?? null
}

export function channelForFailureTag(tag: CrawlFailureTag | null): CrawlChannel | null {
  if (!tag) return null
  if (tag === 'captcha_or_block' || tag === 'forbidden') return 'browser'
  if (tag === 'rate_limited') return 'mcp'
  if (tag === 'wrong_channel') return 'browser'
  return null
}
