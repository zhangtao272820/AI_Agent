import type { WebSearchHit } from './webSearchTool'
import {
  webSearchToolSearchDetailed,
  resolveWebSearchProvider,
  isManagerWebSearchEnabled,
  hasConfiguredSearchBackend,
  webSearchProviderFallbackChain,
  resolveWebSearchMode
} from './webSearchTool'
import { searchProviderWarning } from './managerWebSearch'
import { resolveSearchPlan } from './managerSearchPlannerLlm'
import type { SearchPlan } from './managerSearchPlanner'
import { maxSearchRounds, isSearchLoopEnabled } from './managerSearchVerifier'
import { filterSearchHitsForPrompt, verifySearchCoverageHybrid } from './managerSearchVerifierLlm'
import type { SearchVerifyResult } from './managerSearchVerifier'
import type { TaskClause } from '../../graph/core/routing/clauses'
import { seedUrlsFromHits } from './managerWebSearch'
import {
  searchMaxHits,
  searchMaxQueriesPerRound,
  searchMaxSeeds,
  searchResultsPerQuery
} from './managerSearchConfig'
import { ChatOpenAI } from '@langchain/openai'

export type SearchLoopResult = {
  searchHits: WebSearchHit[]
  seedUrls: string[]
  searchRounds: number
  searchPlan: SearchPlan
  lastVerify: SearchVerifyResult | null
  serpFilterNote?: string
  searchError?: string
  tavilyAnswer?: string
  searchMode?: 'general' | 'news'
  /** P3：search 节点内 LLM（plan / verify / filter）累计 token */
  searchLlmTokens: number
}

export async function runSearchLoop(input: {
  userText: string
  clauses?: TaskClause[]
  initialQueries: string[]
  onRound?: (round: number, msg: string) => void
  llm?: ChatOpenAI | null
}): Promise<SearchLoopResult> {
  const provider = resolveWebSearchProvider()
  const searchMode = resolveWebSearchMode(input.userText)
  input.onRound?.(0, '规划检索 query…')
  const { plan, llmTokens: planTokens } = await resolveSearchPlan(input.userText, input.llm ?? null, input.clauses)
  let searchLlmTokens = planTokens
  const queries = [...new Set([...plan.subQueries, ...input.initialQueries])]
    .map((q) => String(q ?? '').trim())
    .filter(Boolean)
    .slice(0, searchMaxQueriesPerRound())

  let allHits: WebSearchHit[] = []
  let lastVerify: Awaited<ReturnType<typeof verifySearchCoverageHybrid>> | null = null
  let tavilyAnswer: string | undefined
  const maxR = isSearchLoopEnabled() ? Math.max(1, maxSearchRounds()) : 1
  let executedRounds = 0

  const providerWarn = searchProviderWarning()
  if (providerWarn) input.onRound?.(0, providerWarn)

  if (!queries.length) {
    input.onRound?.(0, '无可检索公网 query，跳过 SERP')
    return {
      searchHits: [],
      seedUrls: [],
      searchRounds: 0,
      searchPlan: plan,
      lastVerify: null,
      searchLlmTokens
    }
  }

  const fetchWithFallback = async (qs: string[]): Promise<{ hits: WebSearchHit[]; errors: string[]; tavilyAnswer?: string }> => {
    const providers = webSearchProviderFallbackChain(provider)
    const allErrors: string[] = []
    let tavilyAnswer: string | undefined
    for (const p of providers) {
      const { hits, errors, tavilyAnswer: ans } = await webSearchToolSearchDetailed(qs, {
        provider: p,
        maxResultsPerQuery: searchResultsPerQuery(),
        maxTotal: searchMaxHits(),
        mode: searchMode,
        userText: input.userText
      })
      allErrors.push(...errors)
      if (ans && !tavilyAnswer) tavilyAnswer = ans
      if (hits.length) return { hits, errors: allErrors, tavilyAnswer }
    }
    if (allErrors.length) {
      const primaryErr = allErrors.find((e) => e.startsWith(`${provider}「`)) ?? allErrors[0]
      const tail =
        allErrors.length > 1 ? `（共尝试 ${providers.join(' → ')}；末次：${allErrors[allErrors.length - 1]}）` : ''
      input.onRound?.(0, `联网搜索失败：${primaryErr}${tail}`)
    }
    return { hits: [], errors: allErrors }
  }

  for (let round = 1; round <= maxR; round++) {
    const roundQueries = round === 1 ? queries : (lastVerify?.supplementalQueries ?? []).filter(Boolean).slice(0, searchMaxQueriesPerRound())
    if (!roundQueries.length) break

    executedRounds = round
    input.onRound?.(round, `第 ${round}/${maxR} 轮（${provider}${searchMode === 'news' ? '/news' : ''}）：${roundQueries.join(' | ')}`)

    const { hits: batch, errors, tavilyAnswer: ans } = await fetchWithFallback(roundQueries)
    if (ans && !tavilyAnswer) tavilyAnswer = ans
    allHits = mergeHits(allHits, batch)
    if (!allHits.length && errors.length && round === 1) {
      return {
        searchHits: [],
        seedUrls: [],
        searchRounds: executedRounds,
        searchPlan: plan,
        lastVerify: null,
        searchError: errors.join('; '),
        searchLlmTokens,
      }
    }

    lastVerify = await verifySearchCoverageHybrid(allHits, plan, {
      minUrlCount: plan.subQueries.length >= 2 ? 2 : 1,
      userText: input.userText,
      llm: input.llm ?? null,
    })
    if (lastVerify.llmTokens) searchLlmTokens += lastVerify.llmTokens

    if (lastVerify.sufficient) break
    if (!isManagerWebSearchEnabled()) break
    if (!allHits.length) break
    if (!lastVerify.supplementalQueries.length) break
  }

  if (!allHits.length && input.initialQueries.length) {
    input.onRound?.(
      0,
      hasConfiguredSearchBackend()
        ? '未获取到 SERP 结果，建议换更具体关键词'
        : '未获取到 SERP 结果：请配置 SEARXNG_BASE_URL 或 TAVILY/SERPER API Key'
    )
  }

  let serpFilterNote: string | undefined
  if (allHits.length) {
    const filtered = await filterSearchHitsForPrompt(allHits, {
      userText: input.userText,
      plan,
      llm: input.llm ?? null,
      minKeep: 2
    })
    if (filtered.llmTokens) searchLlmTokens += filtered.llmTokens
    if (filtered.dropped > 0) {
      allHits = filtered.hits
      serpFilterNote = filtered.note
      input.onRound?.(0, filtered.note ?? `语义过滤：保留 ${allHits.length} 条 SERP`)
    }
  }

  return {
    searchHits: allHits,
    seedUrls: seedUrlsFromHits(allHits, { maxTotal: searchMaxSeeds() }),
    searchRounds: executedRounds || (allHits.length ? 1 : 0),
    searchPlan: plan,
    lastVerify,
    serpFilterNote,
    searchError: !allHits.length && providerWarn ? providerWarn : undefined,
    tavilyAnswer,
    searchMode,
    searchLlmTokens,
  }
}

function mergeHits(a: WebSearchHit[], b: WebSearchHit[]): WebSearchHit[] {
  const seen = new Set<string>()
  const out: WebSearchHit[] = []
  for (const h of [...a, ...b]) {
    const u = String(h.url ?? '').trim()
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(h)
  }
  return out
}
