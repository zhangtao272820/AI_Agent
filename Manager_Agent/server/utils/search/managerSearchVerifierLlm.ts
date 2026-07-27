import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { ChatOpenAI } from '@langchain/openai'

import type { SearchPlan } from './managerSearchPlanner'
import { safeJsonParse } from '../../graph/core/shared/llmJson'
import { verifySearchCoverage, type SearchVerifyResult } from './managerSearchVerifier'
import type { WebSearchHit } from './webSearchTool'
import { webSearchFlag } from './managerWebSearchMode'
import { llmTokensFromResponse } from './managerSearchLlmTokens'

export function isSearchVerifyLlmEnabled(): boolean {
  return webSearchFlag('MANAGER_SEARCH_VERIFY_LLM', true, false)
}

export type SerpFilterResult = {
  hits: WebSearchHit[]
  dropped: number
  note?: string
  llmTokens?: number
}

function hitsPreview(hits: WebSearchHit[], cap = 8): string {
  return hits
    .slice(0, cap)
    .map((h, i) => {
      const snip = String(h.snippet ?? '').slice(0, 180)
      return `${i + 1}. ${String(h.title ?? '').slice(0, 120)}\n   URL: ${h.url}\n   ${snip}`
    })
    .join('\n')
}

/**
 * 规则验证 + 可选 LLM 语义复核（覆盖不足或边界分数时补搜 query 更准）。
 */
export async function verifySearchCoverageHybrid(
  hits: WebSearchHit[],
  plan: SearchPlan,
  opts?: {
    minUrlCount?: number
    userText?: string
    llm?: ChatOpenAI | null
  }
): Promise<SearchVerifyResult> {
  const rule = verifySearchCoverage(hits, plan, { minUrlCount: opts?.minUrlCount })
  if (rule.sufficient) return rule
  if (!isSearchVerifyLlmEnabled() || !opts?.llm || !hits.length) return rule

  try {
    const prompt = [
      '你是联网检索质量评估器。根据用户问题、子 query 与 SERP 命中，判断是否已足够支撑后续回答或网页精抓。',
      '只输出 JSON：{"sufficient":boolean,"supplementalQueries":string[],"note":string}',
      'supplementalQueries 最多 2 条，仅在不 sufficient 时填写。',
      '',
      `用户问题：${String(opts.userText ?? '').slice(0, 400)}`,
      `子 query：${plan.subQueries.join(' | ')}`,
      `期望证据：${plan.expectedEvidence.join('；') || '权威公开网页'}`,
      '',
      'SERP 命中：',
      hitsPreview(hits)
    ].join('\n')

    const res = await opts.llm.invoke([new SystemMessage('只输出 JSON'), new HumanMessage(prompt)])
    const raw = safeJsonParse(String((res as { content?: unknown }).content ?? ''))
    if (!raw || typeof raw !== 'object') return rule

    const o = raw as { sufficient?: boolean; supplementalQueries?: unknown; note?: string }
    const sufficient = o.sufficient === true
    const supplementalQueries = Array.isArray(o.supplementalQueries)
      ? o.supplementalQueries.map((q) => String(q ?? '').trim()).filter((q) => q.length >= 4).slice(0, 2)
      : rule.supplementalQueries
    const note = String(o.note ?? '').trim() || rule.note

    const llmTokens = llmTokensFromResponse(res)
    if (sufficient) {
      return {
        ...rule,
        sufficient: true,
        score: Math.max(rule.score, 0.72),
        supplementalQueries: [],
        note: note.startsWith('LLM') ? note : `LLM 复核通过：${note}`,
        llmTokens,
      }
    }

    return {
      ...rule,
      supplementalQueries: supplementalQueries.length ? supplementalQueries : rule.supplementalQueries,
      note: note.startsWith('LLM') ? note : `LLM 复核：${note}`,
      llmTokens,
    }
  } catch {
    return rule
  }
}

/**
 * 语义过滤：剔除与用户问题无关的 SERP 条目后再入 prompt / seedUrls。
 * 仅在 MANAGER_SEARCH_VERIFY_LLM=1 且命中数 > minKeep 时调用 LLM。
 */
export async function filterSearchHitsForPrompt(
  hits: WebSearchHit[],
  opts?: {
    userText?: string
    plan?: SearchPlan | null
    llm?: ChatOpenAI | null
    minKeep?: number
  }
): Promise<SerpFilterResult> {
  const minKeep = Math.max(1, Number(opts?.minKeep ?? 2))
  if (!isSearchVerifyLlmEnabled() || !opts?.llm || hits.length <= minKeep) {
    return { hits, dropped: 0 }
  }

  try {
    const prompt = [
      '你是联网检索结果过滤器。根据用户问题，从 SERP 命中中保留与回答或后续网页抓取相关的条目。',
      '只输出 JSON：{"keepIndices":number[],"note":string}',
      'keepIndices 为 1-based 序号，至少保留 1 条、最多保留全部；剔除广告、无关百科、重复主题。',
      '',
      `用户问题：${String(opts.userText ?? '').slice(0, 400)}`,
      opts?.plan?.subQueries?.length ? `子 query：${opts.plan.subQueries.join(' | ')}` : '',
      '',
      'SERP 命中：',
      hitsPreview(hits, 12)
    ]
      .filter(Boolean)
      .join('\n')

    const res = await opts.llm.invoke([new SystemMessage('只输出 JSON'), new HumanMessage(prompt)])
    const raw = safeJsonParse(String((res as { content?: unknown }).content ?? ''))
    if (!raw || typeof raw !== 'object') return { hits, dropped: 0 }

    const o = raw as { keepIndices?: unknown; note?: string }
    const indices = Array.isArray(o.keepIndices)
      ? o.keepIndices
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= hits.length)
      : []
    const unique = [...new Set(indices)]
    if (!unique.length) return { hits, dropped: 0 }

    const kept = unique.map((i) => hits[i - 1]!).filter(Boolean)
    const dropped = hits.length - kept.length
    if (dropped <= 0) return { hits, dropped: 0 }

    const note = String(o.note ?? '').trim()
    return {
      hits: kept.length ? kept : hits.slice(0, minKeep),
      dropped,
      note: note ? `语义过滤剔除 ${dropped} 条：${note}` : `语义过滤剔除 ${dropped} 条无关命中`,
      llmTokens: llmTokensFromResponse(res),
    }
  } catch {
    return { hits, dropped: 0 }
  }
}
