import { unwrapAgentCall } from '../../../utils/agents/agentResult'
import type { AgentCallResult, AgentResult } from '../../../utils/agents/agentResult'
import { callRagProbe, ragProbeTimeoutMs } from '../../../utils/agents/ragClient'
import { buildRagRefocusMessage, isRagRelevanceJudgeEnabled, refineRagAnswerIfIrrelevant } from '../../../utils/rag/managerRagRelevance'
import type { ManagerGraphState } from '../../state/state'
import { resolveLeanRagQuery } from '../probe/retrieverPlan'
import { isManagerRagRetrieveFirstEnabled, shouldSkipRagRelevanceRefine, shouldTreatRagAsMiss } from '../rag/ragRetrievePolicy'
import { buildRagHistoryFromState } from '../runtime/sessionBridge'
import { extractStructuredPayload } from '../shared'
import { parseRagClarifyPayload } from '../text'
import { resolveRagRetrievalBundle, tryRagProbeSnippetFastPath, finishRagFastPath, tryRagRetrieveAlignedPath } from './ragRetrieval'
import { countRagEvidenceUnits, mergeRagClarifyQuestions, isChatRevisionMeta } from './sharedHelpers'
import type { AgentExecutorDeps, AgentExecutorOpts, AgentStepOutcome } from './types'
import { callRagMcpRetrieve } from '../../../utils/mcp/managerMcpHost'

export function isRagMcpFirstEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_RAG_MCP_FIRST ?? '0').trim() === '1'
}

export async function executeRagStep(
  deps: AgentExecutorDeps,
  opts: AgentExecutorOpts,
  input: {
    state: ManagerGraphState
    question: string
    baseQuery: string
    effQuery: string
    timeoutMs: number
    sendThinking: (t: string) => void
    sendDelta?: (d: string) => void
    allowRetry: boolean
    onStrategyHint?: (meta: unknown) => void
  }
): Promise<AgentStepOutcome> {
  let ragEvidence: Record<string, unknown> | null = null
  let ragAgentResult: import('../../utils/agents/types').AgentResult | undefined
  const revisionSkipCache = isChatRevisionMeta(input.state.meta)
  let probeRag = input.state.probe?.rag
  const leanForProbe = resolveLeanRagQuery(String(input.baseQuery || input.question || ''), String(input.question || ''))

  if (Number(probeRag?.hits ?? 0) <= 0 && leanForProbe) {
    const freshProbe = await callRagProbe({
      ragAgentHttpUrl: opts.ragAgentHttpUrl,
      timeoutMs: Math.min(input.timeoutMs, ragProbeTimeoutMs()),
      query: leanForProbe,
      userId: opts.userId,
      traceId: opts.runId,
      signal: opts.signal
    }).catch(() => null)
    if (freshProbe && (freshProbe.hits ?? 0) > 0) {
      probeRag = {
        hasDocs: Boolean(freshProbe.hasDocs ?? probeRag?.hasDocs),
        hits: freshProbe.hits ?? 0,
        sources: freshProbe.sources ?? [],
        snippets: freshProbe.snippets ?? []
      }
    }
  }

  const bundle = await resolveRagRetrievalBundle(deps, {
    userTask: input.question,
    baseQuery: input.baseQuery,
    probeRag,
    turnScopeMode: String((input.state.meta as { turnScopeMode?: string } | null)?.turnScopeMode || '').trim() || null,
    turnKind: String((input.state.meta as { turnKind?: string } | null)?.turnKind || '').trim() || null
  })
  const leanRagQuery = bundle.leanQuery || input.baseQuery
  const ragMessage = bundle.message || leanRagQuery
  const managerRagTask = bundle.managerRagTask ?? null
  const ragUi = { leanRagQuery, sendThinking: input.sendThinking, sendDelta: input.sendDelta }
  if (bundle.meta?.mode === 'heuristic_v1') {
    input.onStrategyHint?.(bundle.meta)
  }

  const aligned = await tryRagRetrieveAlignedPath({
    state: input.state,
    question: input.question,
    leanRagQuery,
    managerRagTask,
    probeRag,
    opts,
    timeoutMs: input.timeoutMs,
    mode: 'default',
    ragEvidenceMatchJudge: deps.ragEvidenceMatchJudge
  })
  if (!aligned && isManagerRagRetrieveFirstEnabled()) {
    const relaxed = await tryRagRetrieveAlignedPath({
      state: input.state,
      question: input.question,
      leanRagQuery,
      managerRagTask,
      probeRag,
      opts,
      timeoutMs: input.timeoutMs,
      mode: 'relaxed',
      ragEvidenceMatchJudge: deps.ragEvidenceMatchJudge
    })
    if (relaxed) {
      return finishRagFastPath(
        ragUi,
        opts,
        probeRag,
        relaxed,
        'RAG Agent：retrieve-first 宽松模式命中…'
      )
    }
  }
  if (aligned) {
    return finishRagFastPath(
      ragUi,
      opts,
      probeRag,
      aligned,
      'RAG Agent：检索命中，快路径整理事实块…'
    )
  }

  const probeHitCount = Number(probeRag?.hits ?? 0) || 0
  if (probeHitCount > 0) {
    const probeFast = tryRagProbeSnippetFastPath({ leanRagQuery, probeRag })
    if (probeFast) {
      return finishRagFastPath(
        ragUi,
        opts,
        probeRag,
        probeFast,
        `RAG Agent：probe 命中 ${probeHitCount} 条，快路径输出…`
      )
    }
  }

  if (isRagMcpFirstEnabled()) {
    try {
      input.sendThinking('RAG Agent：MCP 主路径（rag retrieve）…')
      const mcpOut = await callRagMcpRetrieve({ query: leanRagQuery || ragMessage })
      if (mcpOut.ok && mcpOut.text.trim()) {
        return {
          ok: true,
          agent: 'rag',
          output: mcpOut.text.trim(),
          query: input.question,
          parsed: extractStructuredPayload(mcpOut.text),
          evidence: {
            kind: 'rag',
            query: leanRagQuery,
            transport: 'mcp',
            source_count: (mcpOut.raw as Record<string, unknown>)?.source_count,
          },
        }
      }
    } catch (mcpErr) {
      input.sendThinking(
        `RAG Agent：MCP 失败，回退 HTTP（${String((mcpErr as Error)?.message || mcpErr).slice(0, 120)}）`
      )
    }
  }

  const ragHistory =
    buildRagHistoryFromState(
      input.state.messages as Array<{ role?: string; content?: string }>,
      input.question,
      String((input.state.meta as { turnScopeMode?: string } | null)?.turnScopeMode || '').trim() || null,
      String((input.state.meta as { turnKind?: string } | null)?.turnKind || '').trim() || null
    ) || opts.ragHistory
  const callRag = (message: string, timeoutMs: number, extra?: { skipCache?: boolean }) =>
    deps.callRagAgent({
      ragAgentHttpUrl: opts.ragAgentHttpUrl,
      timeoutMs,
      message,
      retrievalQuery: leanRagQuery,
      managerRagTask,
      history: ragHistory,
      conversationId: opts.ragConversationId,
      userId: opts.userId,
      traceId: opts.runId,
      skipCache: extra?.skipCache ?? revisionSkipCache,
      deferStreamDelta: probeHitCount > 0,
      sendThinking: input.sendThinking,
      sendDelta: (d: string) => {
        input.sendDelta?.(d)
        opts.sendEvent({ event: 'delta', data: d, from: 'rag' })
      },
      signal: opts.signal,
      onEvidence: (e: unknown) => {
        ragEvidence = (e as Record<string, unknown>) || null
      },
      onAgentResult: (ar) => {
        ragAgentResult = ar
      }
    })

  try {
    const chatMessage = probeHitCount > 0 ? leanRagQuery : ragMessage
    const chatTimeout = probeHitCount > 0 ? Math.min(input.timeoutMs, 28_000) : input.timeoutMs
    const ragCall = await callRag(chatMessage, chatTimeout)
    let ragOut = unwrapAgentCall(ragCall as string | AgentCallResult).answer.trim()
    if (unwrapAgentCall(ragCall as string | AgentCallResult).agentResult) {
      ragAgentResult = unwrapAgentCall(ragCall as string | AgentCallResult).agentResult
    }
    if (isRagRelevanceJudgeEnabled() && deps.ragRelevanceJudge && !shouldSkipRagRelevanceRefine(ragEvidence as Record<string, unknown>, ragOut)) {
      const refined = await refineRagAnswerIfIrrelevant({
        query: leanRagQuery,
        userTask: input.question,
        answer: ragOut,
        evidence: ragEvidence,
        judge: deps.ragRelevanceJudge,
        evidenceMatchJudge: deps.ragEvidenceMatchJudge,
        probeSources: probeRag?.sources,
        probeSnippets: probeRag?.snippets,
        callRag: (msg) => callRag(msg, Math.min(opts.timeoutMs, 45_000), { skipCache: true }),
        onEvidence: (e: unknown) => {
          ragEvidence = (e as Record<string, unknown>) || null
        }
      })
      ragOut = String(refined.answer ?? '').trim()
      if (refined.evidence) ragEvidence = refined.evidence as Record<string, unknown>
    }
    const ragClarify = parseRagClarifyPayload(ragOut)
    let evidenceUnits = countRagEvidenceUnits(ragEvidence, probeRag)
    if (!ragEvidence && evidenceUnits === 0 && deps.ragEvidenceFromProbe && Number(probeRag?.hits ?? 0) > 0) {
      const fromProbe = deps.ragEvidenceFromProbe(leanRagQuery, probeRag) as Record<string, unknown> | null
      if (fromProbe) {
        ragEvidence = fromProbe
        evidenceUnits = countRagEvidenceUnits(ragEvidence, probeRag)
      }
    }
    const ragSaysNotFound = shouldTreatRagAsMiss(ragOut, evidenceUnits)
    if (ragSaysNotFound) {
      input.sendThinking('RAG Agent：对话检索未命中，改用 retrieve 兜底…')
      const retrieveFallback = await tryRagRetrieveAlignedPath({
        state: input.state,
        question: input.question,
        leanRagQuery,
        managerRagTask,
        probeRag,
        opts,
        timeoutMs: Math.min(input.timeoutMs, 25_000),
        mode: 'relaxed',
        ragEvidenceMatchJudge: deps.ragEvidenceMatchJudge
      })
      if (retrieveFallback) {
        return finishRagFastPath(ragUi, opts, probeRag, retrieveFallback, 'RAG Agent：retrieve 兜底命中…')
      }
      if (probeHitCount > 0) {
        const probeFast = tryRagProbeSnippetFastPath({ leanRagQuery, probeRag })
        if (probeFast) {
          return finishRagFastPath(
            ragUi,
            opts,
            probeRag,
            probeFast,
            `RAG Agent：probe 兜底 ${probeHitCount} 条…`
          )
        }
      }
    }
    const agentNeedsClarify = Boolean(ragAgentResult?.needs_clarify)
    const clarifyQuestions = mergeRagClarifyQuestions(ragOut, ragClarify, evidenceUnits, agentNeedsClarify)
    return {
      ok: true,
      agent: 'rag',
      output: ragOut,
      query: leanRagQuery,
      parsed: extractStructuredPayload(ragOut),
      evidence: ragEvidence ? { ...ragEvidence } : undefined,
      clarifyQuestions,
      meta: ragAgentResult ? { agentResult: ragAgentResult } : undefined
    }
  } catch (e: unknown) {
    const err = String((e as Error)?.message || e || 'unknown error')
    const hits = Number(probeRag?.hits ?? 0) || 0
    if (input.allowRetry && hits > 0) {
      try {
        const retryQuery = buildRagRefocusMessage(
          input.question,
          input.baseQuery,
          '请排除与问句无关的行业规范/通用补贴文档，仅保留个人收支相关来源。',
          'irrelevant'
        )
        const res2 = await callRag(retryQuery, Math.min(opts.timeoutMs, 45_000), { skipCache: true })
        const retryUnwrapped = unwrapAgentCall(res2 as string | AgentCallResult)
        const retryAnswer = retryUnwrapped.answer.trim()
        if (!ragEvidence) ragEvidence = (await deps.probeRagEvidence(retryQuery)) as Record<string, unknown> | null
        const ragClarify = parseRagClarifyPayload(retryAnswer)
        const evidenceUnits = countRagEvidenceUnits(ragEvidence, probeRag)
        const clarifyQuestions = mergeRagClarifyQuestions(retryAnswer, ragClarify, evidenceUnits)
        return {
          ok: true,
          agent: 'rag',
          output: retryAnswer,
          query: input.effQuery,
          parsed: extractStructuredPayload(retryAnswer),
          evidence: ragEvidence ? { ...ragEvidence } : undefined,
          clarifyQuestions,
          meta: retryUnwrapped.agentResult ? { agentResult: retryUnwrapped.agentResult } : undefined
        }
      } catch (e2: unknown) {
        const err2 = String((e2 as Error)?.message || e2 || 'unknown error')
        return {
          ok: false,
          agent: 'rag',
          output: `RAG 步骤失败：${err}\nRAG 重试失败：${err2}\n\n下一步：确认文档索引服务是否可用，或缩小问题范围（给出要查的文档名/章节/关键词）。`,
          query: input.effQuery,
          error: err2
        }
      }
    }
    const output =
      hits > 0
        ? `RAG 步骤失败：${err}\n\n探测显示命中文档（hits=${hits}），但拉取失败。下一步：确认 RAG 服务是否可用，或缩小查询范围（给出关键词/文档名）。`
        : `RAG 步骤失败：${err}\n\n下一步：提供更明确的文档线索（文档名/章节/关键词），或先上传/索引相关文件。`
    return { ok: false, agent: 'rag', output, query: input.effQuery, error: err }
  }
}


