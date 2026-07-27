import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import { safeJsonParse } from '../../graph/core/shared'
import type { SearchPlan } from './managerSearchPlanner'
import type { TaskClause } from '../../graph/core/routing/clauses'
import {
  decomposeSearchQueries,
  hasWebSearchBoundClause,
  webSearchClauseTexts
} from './managerWebSearch'
import { llmTokensFromResponse } from './managerSearchLlmTokens'

const SearchPlanSchema = z.object({
  subQueries: z.array(z.string()).min(1).max(2),
  expectedEvidence: z.array(z.string()).max(6),
  stopCondition: z.string(),
  confidence: z.number().min(0).max(1).optional()
})

function looksLikeFullUserUtterance(query: string, userText: string): boolean {
  const q = String(query || '').replace(/\s+/g, '').trim()
  const u = String(userText || '').replace(/\s+/g, '').trim()
  if (!q || !u || u.length < 12) return false
  return q === u || (u.includes(q) && q.length / u.length > 0.85) || (q.includes(u) && u.length / q.length > 0.7)
}

function emptySearchPlan(stop = '无可检索的公网子句，跳过 SERP'): SearchPlan {
  return {
    subQueries: [],
    expectedEvidence: [],
    stopCondition: stop
  }
}

export async function buildSearchPlanByLlm(
  userText: string,
  model: ChatOpenAI | null,
  clauses?: TaskClause[],
): Promise<{ plan: SearchPlan; llmTokens: number } | null> {
  if (!model) return null
  const webClauses = webSearchClauseTexts(clauses)
  // 复合任务无公网子句：不调 LLM，避免把整段原话拆成搜索
  if (Array.isArray(clauses) && clauses.length >= 2 && !webClauses.length) return null
  const scopeText = webClauses.length
    ? webClauses.join('\n')
    : String(userText ?? '').trim()
  if (!scopeText) return null
  try {
    const clauseHint = webClauses.length
      ? webClauses.map((t) => `- ${t}`).join('\n')
      : '（无 crawler/media 子句；仅当整句确为公网检索任务时才生成 subQueries）'
    const res = await model.invoke([
      [
        'system',
        [
          '你是联网检索规划器。根据【公网检索范围】生成搜索计划，只输出 JSON。',
          'subQueries 1-2 条，每条 4-120 字，可直接用于搜索引擎。',
          '【禁止】把知识库/数据库/个人助手（天气 get_weather）/写报告整段用户原话写入 subQueries。',
          '【禁止】为「查天气/气温」生成搜索；天气属 admin，不是联网检索。',
          '仅针对 crawler/music/video 子句或明确的公网页正文需求。',
          'expectedEvidence 写期望证据类型（如政策原文、行情数值、新闻等）。',
          'stopCondition 描述何时停止补搜。',
          'schema: {"subQueries":string[],"expectedEvidence":string[],"stopCondition":string,"confidence":number}'
        ].join('\n')
      ],
      [
        'human',
        [
          `【公网检索范围】\n${scopeText.slice(0, 800)}`,
          `任务子句（仅 crawler/media）：\n${clauseHint}`
        ].join('\n\n')
      ]
    ])
    const parsed = safeJsonParse(String(res.content ?? '').trim())
    const safe = SearchPlanSchema.safeParse(parsed)
    if (!safe.success) return null
    if (Number(safe.data.confidence ?? 0) < 0.45) return null
    let subQueries = safe.data.subQueries.map((q) => String(q).trim()).filter((q) => q.length >= 4).slice(0, 2)
    subQueries = subQueries.filter((q) => !looksLikeFullUserUtterance(q, userText))
    if (!subQueries.length) return null
    return {
      plan: {
        subQueries,
        expectedEvidence: safe.data.expectedEvidence.map((x) => String(x).trim()).filter(Boolean).slice(0, 6),
        stopCondition: String(safe.data.stopCondition || '').trim() || '至少 2 条可用 URL',
      },
      llmTokens: llmTokensFromResponse(res),
    }
  } catch {
    return null
  }
}

export async function resolveSearchPlan(
  userText: string,
  model: ChatOpenAI | null,
  clauses?: TaskClause[],
): Promise<{ plan: SearchPlan; llmTokens: number }> {
  const decomposed = decomposeSearchQueries(userText, clauses)
  if (Array.isArray(clauses) && clauses.length >= 2 && !hasWebSearchBoundClause(clauses)) {
    return { plan: emptySearchPlan(), llmTokens: 0 }
  }
  const llm = await buildSearchPlanByLlm(userText, model, clauses)
  if (llm?.plan.subQueries.length) {
    const webOnly = webSearchClauseTexts(clauses)
    if (webOnly.length) {
      // 有公网子句时：丢弃「整段原话」类 LLM 产出，优先保留合法 subQueries；全无效则用子句原文
      const kept = llm.plan.subQueries.filter((q) => !looksLikeFullUserUtterance(q, userText))
      return {
        plan: {
          ...llm.plan,
          subQueries: kept.length ? kept : decomposed
        },
        llmTokens: llm.llmTokens
      }
    }
    return llm
  }
  return {
    plan: {
      subQueries: decomposed,
      expectedEvidence: decomposed.length ? ['与公网子句相关的权威公开网页'] : [],
      stopCondition: decomposed.length
        ? `至少 ${Math.min(3, Math.max(2, decomposed.length))} 条可用 URL`
        : '无可检索公网子句',
    },
    llmTokens: 0,
  }
}
