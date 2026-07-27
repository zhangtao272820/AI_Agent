import type { TaskClause } from '../../graph/core/routing/clauses'
import { decomposeSearchQueries } from './managerWebSearch'

export type SearchPlan = {
  subQueries: string[]
  expectedEvidence: string[]
  stopCondition: string
}

/** 启发式搜索计划（无 LLM 时中性兜底；不做业务关键词正则） */
export function buildHeuristicSearchPlan(userText: string, clauses?: TaskClause[]): SearchPlan {
  const subQueries = decomposeSearchQueries(userText, clauses)
  return {
    subQueries,
    expectedEvidence: ['与用户问题相关的权威公开网页'],
    stopCondition: `至少 ${Math.min(2, subQueries.length + 1)} 条可用 URL 且覆盖子问题`
  }
}
