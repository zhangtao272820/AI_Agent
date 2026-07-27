/**
 * StepDecide 纯函数（无 LLM / 无 #agent-shared），供 smoke 与 classicStepDecide 共用
 */

import {
  type ClassicStepDecideParsed,
} from './classicStepDecideSchema'
import { isResultPageGateEnabled } from './classicStepDecideSchema'
import { isResultListUrl, isSearchOpenDestinationUrl } from './lobsterAgent/leanBrowsePolicy'
import type { IntentCall } from './lobsterAgent/schemas'
import type { StepDecideObservation } from './classicStepDecideTypes'

export type { StepDecideObservation }

/** 结构性门禁：结果页契约（非用户原话 regex） */
export function gateStepByResultPage(
  step: ClassicStepDecideParsed,
  observation: StepDecideObservation,
  goals?: Record<string, unknown> | null,
): ClassicStepDecideParsed | null {
  if (!isResultPageGateEnabled()) return step
  const mustSearch = !!(goals && (goals as any).mustSearch)
  const onResults = isResultListUrl(observation.url)
  const blocked = new Set(['open_first_result', 'extract_items', 'paginate_next'])
  if (mustSearch && !onResults && blocked.has(step.intent)) {
    // 已离开 SERP 进入详情：勿逼回 search（会回百度再触验证码）
    if (isSearchOpenDestinationUrl(observation.url)) {
      const title = String(observation.title || '').trim()
      return {
        intent: 'done',
        args: {},
        reason: `结果页门禁：已在详情页${title ? `「${title.slice(0, 40)}」` : ''}，结束任务`,
        expect: { stageHint: 'detail' },
        confidence: Math.max(step.confidence, 0.88),
      }
    }
    const q = String((goals as any)?.searchQuery || '').trim()
    return {
      intent: 'search',
      args: q ? { query: q } : {},
      reason: '结果页门禁：未进结果页，禁止 open/extract，先搜索',
      expect: { urlIncludes: ['wd=', '/s?', 'search'], stageHint: 'list' },
      confidence: Math.max(step.confidence, 0.75),
    }
  }
  return step
}

export function toIntentCall(step: ClassicStepDecideParsed): IntentCall {
  const intent = step.intent
  const args = step.args && typeof step.args === 'object' ? step.args : {}
  const reason = step.reason || `step_decide:${intent}`
  if (intent === 'goto') {
    return { intent: 'goto', args: { url: String((args as any).url || '') }, reason }
  }
  if (intent === 'search') {
    return { intent: 'search', args: { query: String((args as any).query || '') }, reason }
  }
  if (intent === 'click_candidate') {
    return { intent: 'click_candidate', args: { cid: String((args as any).cid || '') }, reason }
  }
  if (intent === 'type_into') {
    return {
      intent: 'type_into',
      args: { cid: String((args as any).cid || ''), text: String((args as any).text || '') },
      reason,
    }
  }
  if (intent === 'scroll') {
    return { intent: 'scroll', args: { dy: Number((args as any).dy || 900) }, reason }
  }
  if (intent === 'wait') {
    return { intent: 'wait', args: { ms: Math.max(200, Math.min(120000, Number((args as any).ms || 600))) }, reason }
  }
  if (intent === 'extract_items') {
    const limit = Number((args as any).limit || 0)
    return {
      intent: 'extract_items',
      args: Number.isFinite(limit) && limit > 0 ? { limit: Math.min(20, Math.floor(limit)) } : {},
      reason,
    }
  }
  if (intent === 'perform') {
    return { intent: 'perform', args: { goal: String((args as any).goal || reason) }, reason }
  }
  if (intent === 'click_by_bbox') {
    return { intent: 'click_by_bbox', args: { index: Math.max(0, Math.floor(Number((args as any).index || 0))) }, reason }
  }
  if (intent === 'click_by_text') {
    return { intent: 'click_by_text', args: { text: String((args as any).text || '') }, reason }
  }
  return { intent, reason } as IntentCall
}

/** 结果列表 + 仅抽取：短路，少一轮 decision（P3-L6-6） */
export function maybeLeanExtractShortcut(input: {
  observation: StepDecideObservation
  goals?: Record<string, unknown> | null
}): ClassicStepDecideParsed | null {
  const g = input.goals && typeof input.goals === 'object' ? input.goals : {}
  if (!(g as any).mustExtract) return null
  if ((g as any).mustEnterDetail) return null
  if (!isResultListUrl(input.observation.url)) return null
  if ((input.observation.candidatesTopK || []).length < 2) return null
  const limit = Math.max(0, Math.floor(Number((g as any).extractLimit || 5)))
  return {
    intent: 'extract_items',
    args: limit > 0 ? { limit } : {},
    reason: 'lean:已在结果页，直接抽取',
    expect: { stageHint: 'list', extractMin: Math.max(1, Math.min(limit || 1, 5)) },
    confidence: 0.9,
  }
}

/**
 * OpenClaw 对齐：search_open 已进入详情（非 SERP）且有标题 → 立刻 done
 * 避免 StepDecide 空转 wait / 误 open_first 被门禁打回 search。
 */
export function maybeLeanOpenDoneShortcut(input: {
  observation: StepDecideObservation
  task: string
  goals?: Record<string, unknown> | null
}): ClassicStepDecideParsed | null {
  const g = input.goals && typeof input.goals === 'object' ? input.goals : {}
  const t = String(input.task || '')
  const needsOpen =
    !!(g as any).mustEnterDetail ||
    /打开第|第一条|第一个|首条|first\s*result|点.*第一条|进入.*结果/i.test(t) ||
    (/搜索|search/i.test(t) && /标题|链接|url|告诉我|提取/i.test(t))
  if (!needsOpen) return null
  const url = String(input.observation.url || '')
  if (!isSearchOpenDestinationUrl(url)) return null
  const title = String(input.observation.title || '').trim()
  const snippet = String(input.observation.pageTextSnippet || '').trim()
  if (title.length < 2 && snippet.length < 30) return null
  return {
    intent: 'done',
    args: {},
    reason: `lean:已打开详情「${(title || url).slice(0, 48)}」，完成任务`,
    expect: { stageHint: 'detail' },
    confidence: 0.93,
  }
}
