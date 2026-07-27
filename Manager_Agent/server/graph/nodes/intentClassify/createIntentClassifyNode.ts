import { clausesFromMeta } from '../../core/routing/clauses'
import {
  alignIntentClassifyWithRecall,
  intentRecallHitToClassify,
  shouldUseIntentRagFastPath
} from '../../core/rag/intentRagRecallCore'
import { buildIntentRagRecall, isIntentRagRecallEnabled } from '../../core/rag/intentRagRecall'
import { classifyUserIntentByLlm, isIntentClassifyEnabled } from '../../llm/intentClassifyLlm'
import { reconcileIntentClassifyDataPlane } from '../../orchestrate/routeOrchestration'
import { isIntentMergedLlmEnabled, understandUserIntentMerged } from '../../llm/intentUnderstandLlm'
import {
  buildIntentRagQueryText,
  buildSessionIntentAnchor,
  sessionIntentAnchorFromMeta
} from '../../core/memory/multiTurnIntent'
import {
  buildChitchatIntentClassify,
  detectTopicShiftStructural,
  resolveTurnRoutingScope,
  shouldDirectChitchatSynth
} from '../../core/routing/turnScope'
import { routingHeuristicsUserText, shouldSkipRouteHistoryBias } from '../../core/text'
import { taskConstraintsFromMeta, resolveTaskConstraints } from '../../llm/taskConstraintsLlm'
import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'
import { shouldSkipLegacyRoutingNodes } from '../../orchestrate/unifiedRouting'

import type { CreateIntentClassifyNodeDeps } from './types'

export function createIntentClassifyNode(deps: CreateIntentClassifyNodeDeps) {
  const { policyDir, opts, lastUserText, llmInvoke, mergeMeta } = deps

  return async (state: any) => {
    if (shouldSkipLegacyRoutingNodes(state) && state?.meta?.unifiedOrchestrator) {
      return {}
    }

    if (!isIntentClassifyEnabled()) {
      return { meta: mergeMeta(state, { intentClassifyMode: 'off' as const }) }
    }

    opts.sendEvent({ event: 'phase', data: 'intent_classify', from: 'manager' })
    const lastOnly = String(lastUserText(state.messages) || '').trim()
    const sessionAnchor = sessionIntentAnchorFromMeta(state.meta)
    const turnScope = resolveTurnRoutingScope({
      messages: state.messages as any,
      lastUser: lastOnly,
      sessionAnchor,
      attachment: state.mediaAttachment,
      meta: state.meta
    })

    if (
      shouldDirectChitchatSynth({ meta: state.meta, turnScope }) &&
      !state.mediaAttachment?.filePath
    ) {
      const classify = buildChitchatIntentClassify(lastOnly)
      if (!state?.meta?.lowCostMode) {
        opts.sendEvent({
          event: 'thinking',
          data: '意图识别：寒暄/确认 → 直连对话（不调用子 Agent）',
          from: 'manager'
        })
      }
      return {
        meta: mergeMeta(state, {
          intentClassify: classify,
          intentClassifyMode: 'skip',
          turnScopeMode: turnScope.mode,
          directChitchatSynth: true,
          sessionIntentAnchor: null
        })
      }
    }

    const turnIsolated = turnScope.mode === 'current_only' || turnScope.mode === 'topic_shift'
    const routingContext = turnScope.routingContext
    const clauses = clausesFromMeta(state.meta)

    const skipRecall =
      Boolean(state.mediaAttachment?.filePath) ||
      turnScope.suppressSessionAnchor ||
      turnIsolated ||
      shouldSkipRouteHistoryBias(lastOnly, state.mediaAttachment, state.messages as any)

    const ragQuery = buildIntentRagQueryText({
      messages: state.messages as any,
      lastUser: lastOnly,
      sessionAnchor: turnScope.suppressSessionAnchor ? null : sessionAnchor
    })

    let metaPatch: Record<string, unknown> = {}
    let ragRecall = null as Awaited<ReturnType<typeof buildIntentRagRecall>> | null

    if (isIntentRagRecallEnabled() && !skipRecall && ragQuery.query.length >= 6) {
      try {
        ragRecall = await buildIntentRagRecall({
          policyDir,
          queryText: ragQuery.query,
          probe: state.probe,
          sessionAnchor: turnScope.suppressSessionAnchor ? null : sessionAnchor,
          multiTurn: ragQuery.multiTurn
        })
        metaPatch = {
          intentRagRecall: ragRecall,
          intentRagRecallCount: ragRecall.count,
          intentRagVectorRecall: ragRecall.vectorRecall,
          intentRagMultiTurn: ragQuery.multiTurn
        }
        if (ragRecall.count > 0 && !state?.meta?.lowCostMode) {
          opts.sendEvent({
            event: 'thinking',
            data: `意图 RAG：召回 ${ragRecall.count} 条（${ragRecall.vectorRecall ? '向量' : 'lexical'}${ragQuery.multiTurn ? '，多轮' : ''}）`,
            from: 'manager'
          })
        }
      } catch {
        ragRecall = null
      }
    }

    let classify = null as Awaited<ReturnType<typeof classifyUserIntentByLlm>>
    let classifyMode: 'llm' | 'rag_fast' | 'merged' | 'skip' = 'skip'
    let constraints = taskConstraintsFromMeta(state.meta)
    let coalescedTask = String(state.meta?.nlHeuristicTask || '').trim()

    if (ragRecall?.topHit && shouldUseIntentRagFastPath(ragRecall.topHit, lastOnly) && !ragQuery.multiTurn && !turnScope.suppressSessionAnchor) {
      classify = intentRecallHitToClassify(ragRecall.topHit)
      classifyMode = 'rag_fast'
      if (!constraints) constraints = await resolveTaskConstraints(lastOnly, llmInvoke, state)
      if (!state?.meta?.lowCostMode) {
        opts.sendEvent({
          event: 'thinking',
          data: `意图 RAG 快路径：${classify.primaryIntent} / ${classify.planShortcut}（score ${ragRecall.topHit.score.toFixed(2)}）`,
          from: 'manager'
        })
      }
    } else if (isIntentMergedLlmEnabled() && !state?.meta?.lowCostMode && !turnScope.suppressMultiTurnMerge) {
      try {
        const merged = await understandUserIntentMerged({
          messages: state.messages as any,
          lastUser: lastOnly,
          routingContext,
          clauses,
          probe: state.probe,
          ragRecall,
          sessionAnchor: turnScope.suppressSessionAnchor ? null : sessionAnchor,
          llmInvoke,
          state
        })
        if (merged) {
          classify = merged.classify
          constraints = merged.constraints
          if (merged.coalesced) {
            coalescedTask = merged.coalesced
            metaPatch = { ...metaPatch, nlHeuristicTask: coalescedTask, nlCoalesceUsed: true, intentMergedLlm: true }
          } else {
            metaPatch = { ...metaPatch, intentMergedLlm: true }
          }
          metaPatch = { ...metaPatch, taskConstraints: constraints }
          if (ragRecall) classify = alignIntentClassifyWithRecall(classify, ragRecall, lastOnly)
          classifyMode = 'merged'
          if (!state?.meta?.lowCostMode) {
            opts.sendEvent({
              event: 'thinking',
              data: `合并理解：${classify.primaryIntent}${classify.isMulti ? '（multi）' : ''} shortcut=${classify.planShortcut}${coalescedTask ? '，已合并多轮' : ''}`,
              from: 'manager'
            })
          }
        }
      } catch {
        /* fallback below */
      }
    }

    if (!classify) {
      const heuristicsText = coalescedTask
        ? coalescedTask
        : turnScope.suppressMultiTurnMerge
          ? lastOnly
          : String(routingHeuristicsUserText(state.messages as any) || '').trim() || lastOnly

      if (!constraints) {
        constraints = await resolveTaskConstraints(heuristicsText, llmInvoke, state)
        metaPatch = { ...metaPatch, taskConstraints: constraints }
      }

      try {
        classify = await classifyUserIntentByLlm({
          userText: lastOnly,
          heuristicsText,
          clauses,
          constraints,
          probe: state.probe,
          ragRecall,
          llmInvoke,
          state
        })
        if (classify && ragRecall) {
          classify = alignIntentClassifyWithRecall(classify, ragRecall, lastOnly)
        }
        if (classify) classifyMode = 'llm'
      } catch {
        classify = null
      }

      if (classify && classifyMode === 'llm' && !state?.meta?.lowCostMode) {
        opts.sendEvent({
          event: 'thinking',
          data: `意图识别：${classify.primaryIntent}${classify.isMulti ? '（multi）' : ''}，快捷=${classify.planShortcut}，置信 ${classify.confidence.toFixed(2)}`,
          from: 'manager'
        })
      }
    }

    if (classify) classify = reconcileIntentClassifyDataPlane(classify)

    if (classify) {
      const topicShift =
        turnScope.mode === 'topic_shift' ||
        detectTopicShiftStructural({
          messages: state.messages as any,
          lastUser: lastOnly,
          sessionAnchor,
          intentClassify: classify,
          turnScopeLlm: state.meta?.turnScopeLlm ?? null
        })
      metaPatch = {
        ...metaPatch,
        turnScopeMode: topicShift ? 'topic_shift' : turnScope.mode,
        ...(topicShift ? { turnTopicShift: true } : {}),
        sessionIntentAnchor: topicShift
          ? null
          : buildSessionIntentAnchor(classify, coalescedTask || undefined)
      }
    }

    return {
      meta: mergeMeta(state, {
        ...metaPatch,
        intentClassify: classify ?? undefined,
        intentClassifyMode: classifyMode
      })
    }
  }
}

