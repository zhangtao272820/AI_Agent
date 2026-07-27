import { clausesFromMeta } from '../../core/routing/clauses'
import {
  decomposeSearchQueries,
  extractCurrentUserInput,
  formatSerpContextForPrompt,
  searchProviderWarning,
  shouldRunWebSearch
} from '../../../utils/search/managerWebSearch'
import { routingHeuristicsUserText } from '../../core/text'
import { isManagerWebSearchEnabled } from '../../../utils/search/webSearchTool'
import { shouldSkipWebSearchStructurally } from '#agent-shared/deterministicPassthrough'
import { shouldForceChatWebDirectSynth } from '../../../utils/chat/managerChatWeb'
import { canCandidateWebDirectSynth, inferWebDirectSynthByLlm } from '../../../utils/search/managerWebDirectSynthLlm'
import { runSearchLoop } from '../../../utils/search/managerSearchLoop'
import { isSearchLoopEnabled } from '../../../utils/search/managerSearchVerifier'
import { searchMaxSeeds } from '../../../utils/search/managerSearchConfig'
import { createManagerChatOpenAI } from '../../../utils/chat/managerChatOpenAI'

import type { CreateWebSearchNodeDeps } from './types'

export function createWebSearchNode(deps: CreateWebSearchNodeDeps) {
  const { opts, lastUserText, mergeMeta, mergeResources, appendMetrics } = deps

  return async (state: any) => {
    if (!isManagerWebSearchEnabled()) {
      return { meta: mergeMeta(state, { webSearchMode: 'off' as const }) }
    }

    const heuristicsText =
      String(state.meta?.nlHeuristicTask || '').trim() ||
      String(routingHeuristicsUserText(state.messages as any) || '').trim() ||
      lastUserText(state.messages)
    const searchText =
      extractCurrentUserInput(heuristicsText) ||
      lastUserText(state.messages) ||
      heuristicsText
    const clauses = clausesFromMeta(state.meta)

    const run = shouldRunWebSearch({ needsWebSearch: state.meta?.needsWebSearch })

    const structuralSkip = run
      ? shouldSkipWebSearchStructurally({
          allowedAgents: Array.isArray(state.meta?.allowedAgents)
            ? (state.meta.allowedAgents as string[])
            : undefined,
          intent: String(state.intent ?? state.meta?.routeIntent ?? '')
        })
      : null
    if (structuralSkip) {
      opts.sendEvent({ event: 'thinking', data: `联网搜索：${structuralSkip}`, from: 'manager' })
      return {
        meta: mergeMeta(state, {
          webSearchMode: 'skip_structural' as const,
          searchHits: [],
          seedUrls: [],
          serpContext: ''
        })
      }
    }

    if (!run) {
      return {
        meta: mergeMeta(state, {
          webSearchMode: 'skip' as const,
          searchHits: [],
          seedUrls: []
        })
      }
    }

    const providerWarn = searchProviderWarning()
    if (providerWarn) {
      opts.sendEvent({ event: 'thinking', data: `联网搜索：${providerWarn}`, from: 'manager' })
    }

    opts.sendEvent({ event: 'phase', data: 'web_search', from: 'manager' })
    const initialQueries = decomposeSearchQueries(searchText, clauses)
    // 复合任务无 crawler/media 子句：禁止把整段原话送入 SERP（天气/知识库/数据库）
    if (!initialQueries.length && clauses.length >= 2) {
      opts.sendEvent({
        event: 'thinking',
        data: '联网搜索：无 crawler/media 子句，跳过 SERP（子任务已分发给 rag/db/admin 等）',
        from: 'manager'
      })
      return {
        meta: mergeMeta(state, {
          webSearchMode: 'skip_no_web_clause' as const,
          searchHits: [],
          seedUrls: [],
          serpContext: '',
          needsWebSearch: false
        })
      }
    }

    if (isSearchLoopEnabled()) {
      opts.sendEvent({
        event: 'thinking',
        data: '联网搜索：多轮模式（Search → Verify → 补搜）',
        from: 'manager'
      })
    }

    let searchError: string | undefined
    let loopResult: Awaited<ReturnType<typeof runSearchLoop>> | null = null
    const searchLlm =
      String(opts.openaiApiKey ?? '').trim()
        ? createManagerChatOpenAI({
            apiKey: String(opts.openaiApiKey),
            modelName: String(opts.openaiModel || 'gpt-4o-mini').trim(),
            openaiBaseUrl: opts.openaiBaseUrl,
            temperature: 0,
            skipThinking: true
          })
        : null

    const t0 = Date.now()

    opts.sendEvent({ event: 'thinking', data: '联网搜索：准备中…', from: 'manager' })

    try {
      loopResult = await runSearchLoop({
        userText: searchText,
        clauses,
        initialQueries,
        llm: searchLlm,
        onRound: (round, msg) => {
          opts.sendEvent({ event: 'thinking', data: `联网搜索 ${msg}`, from: 'manager' })
        }
      })
      const searchMs = Date.now() - t0
      if (appendMetrics && opts.runId) {
        await appendMetrics({
          runId: opts.runId,
          phase: 'web_search',
          ms: searchMs,
          extra: { hits: loopResult?.searchHits?.length ?? 0, rounds: loopResult?.searchRounds ?? 0 }
        }).catch(() => undefined)
      }
    } catch (e: any) {
      searchError = String(e?.message || e || 'search failed')
      if (appendMetrics && opts.runId) {
        await appendMetrics({
          runId: opts.runId,
          phase: 'web_search',
          ms: Date.now() - t0,
          extra: { error: searchError }
        }).catch(() => undefined)
      }
      opts.sendEvent({
        event: 'thinking',
        data: `联网搜索失败：${searchError}（将继续由爬虫 Agent 尝试检索）`,
        from: 'manager'
      })
    }
    if (!searchError && loopResult?.searchError) searchError = loopResult.searchError

    const searchHits = loopResult?.searchHits ?? []
    const seedUrls = loopResult?.seedUrls ?? []
    const serpContext = formatSerpContextForPrompt(searchHits)
    const tavilyAnswer = String(loopResult?.tavilyAnswer ?? '').trim()
    const allowedAgents = Array.isArray(state.meta?.allowedAgents) ? (state.meta.allowedAgents as string[]) : []
    let webDirectSynth = false
    const metaRecord = (state.meta && typeof state.meta === 'object' ? state.meta : {}) as Record<string, unknown>
    const pipelineBlocked =
      metaRecord.requiresAgentPipeline === true || metaRecord.allowChatWebDirect === false
    const chatWebForced = !pipelineBlocked && shouldForceChatWebDirectSynth(metaRecord)
    if (chatWebForced && searchHits.length) {
      webDirectSynth = true
      opts.sendEvent({
        event: 'thinking',
        data: '聊天式联网：SERP 摘要已足够，跳过全量爬虫，直接汇总回答',
        from: 'manager'
      })
    } else if (
      !pipelineBlocked &&
      canCandidateWebDirectSynth({
        intent: String(state.intent ?? ''),
        allowedAgents,
        needsWebSearch: state.meta?.needsWebSearch === true,
        searchHits,
        webExecutionMode: state.meta?.webExecutionMode as import('../../utils/search/managerWebExecutionModeLlm').WebExecutionModeDecision | null,
        chatWebOnly: state.meta?.chatWebOnly === true,
        requiresAgentPipeline: pipelineBlocked
      })
    ) {
      webDirectSynth = await inferWebDirectSynthByLlm({
        taskText: searchText,
        searchHits,
        llm: {
          openaiApiKey: opts.openaiApiKey,
          openaiModel: opts.openaiModel,
          openaiBaseUrl: opts.openaiBaseUrl
        },
        state
      })
      if (webDirectSynth && searchHits.length) {
        opts.sendEvent({
          event: 'thinking',
          data: '联网直答：启发器判定 SERP 已足够，跳过全量爬虫，直接汇总',
          from: 'manager'
        })
      }
    }

    if (searchHits.length) {
      const rounds = loopResult?.searchRounds ?? 1
      const verifyNote = [loopResult?.lastVerify?.note, loopResult?.serpFilterNote].filter(Boolean).join('；')
      opts.sendEvent({
        event: 'thinking',
        data: `联网搜索：${rounds} 轮完成，命中 ${searchHits.length} 条，种子 URL ${seedUrls.length} 个${verifyNote ? `（${verifyNote}）` : ''}`,
        from: 'manager'
      })
      opts.sendEvent({
        event: 'search_sources',
        data: {
          rounds,
          source: 'serp',
          hits: searchHits.slice(0, searchMaxSeeds()).map((h) => ({
            title: String(h.title || h.url || '来源').trim(),
            url: String(h.url || '').trim()
          }))
        },
        from: 'manager'
      })
    } else if (!searchError) {
      opts.sendEvent({
        event: 'thinking',
        data: '联网搜索：未获得可用 SERP 结果，将回退开放式抓取',
        from: 'manager'
      })
    }

    const searchTokens = loopResult?.searchLlmTokens ?? 0
    const resourcePatch =
      searchTokens > 0 && mergeResources
        ? {
            resources: mergeResources(state, {
              usedTokens: Number(state.resources?.usedTokens ?? 0) + searchTokens,
            }),
          }
        : {}

    return {
      ...resourcePatch,
      meta: mergeMeta(state, {
        webSearchMode: loopResult ? ('loop' as const) : ('done' as const),
        searchRounds: loopResult?.searchRounds ?? 0,
        searchPlan: loopResult?.searchPlan,
        searchVerify: loopResult?.lastVerify,
        serpFilterNote: loopResult?.serpFilterNote,
        searchQueries: initialQueries,
        searchHits,
        seedUrls,
        serpContext,
        tavilyAnswer: tavilyAnswer || undefined,
        webDirectSynth: webDirectSynth || undefined,
        searchError,
        searchLlmTokens: searchTokens,
      }),
    }
  }
}

