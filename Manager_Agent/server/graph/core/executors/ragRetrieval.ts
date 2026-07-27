import type { AgentResult } from '../../../utils/agents/agentResult'
import { callRagRetrieve, callRagProbeAsRetrieve } from '../../../utils/agents/ragClient'
import type { RagRetrieveResponse } from '../../../utils/agents/ragClient'
import type { RagEvidenceMatchJudge, RagScopeHintJudge } from '../../../utils/rag/managerRagRelevance'
import { buildAnswerFromProbeSnippets, formatRagEvidenceAsManagerFacts, judgeFilterRagEvidence, judgeFilterRagProbeHint, shouldBypassRagEvidenceJudge } from '../../../utils/rag/managerRagRelevance'
import type { ManagerGraphState } from '../../state/state'
import { buildRagRetrievalMessage, isRetrieverPlanEnabled, resolveLeanRagQuery } from '../probe/retrieverPlan'
import type { RagProbeHint } from '../probe/retrieverPlan'
import type { RagRetrievePrefetchResult } from '../rag/ragPrefetch'
import { ragRetrieveCallOptions } from '../rag/ragRetrievePolicy'
import type { RagRetrieveAttemptMode } from '../rag/ragRetrievePolicy'
import { extractStructuredPayload } from '../shared'
import { countRagEvidenceUnits, RAG_EMPTY_EVIDENCE_CLARIFY } from './sharedHelpers'
import type { AgentExecutorOpts, AgentStepOutcome } from './types'
import type { ManagerRagTaskPayload } from '#agent-shared/managerSubAgentProtocol'

export async function resolveRagRetrievalBundle(
  deps: { ragScopeHintJudge?: RagScopeHintJudge; ragEvidenceMatchJudge?: RagEvidenceMatchJudge },
  input: { userTask: string; baseQuery: string; probeRag?: RagProbeHint | null; turnScopeMode?: string | null; turnKind?: string | null }
) {
  const leanForFilter =
    resolveLeanRagQuery(String(input.baseQuery || input.userTask || '').trim(), String(input.userTask || '').trim()) ||
    String(input.userTask || '').trim()
  const routeProbeHits = Number(input.probeRag?.hits ?? 0) || 0
  const probeRag =
    routeProbeHits > 0
      ? input.probeRag
      : (await judgeFilterRagProbeHint(deps.ragEvidenceMatchJudge, leanForFilter, input.probeRag)) ?? input.probeRag
  let scopeHint = ''
  let retrievalKeywords: string[] | undefined
  let excludeHints: string[] | undefined
  if (isRetrieverPlanEnabled() && deps.ragScopeHintJudge && routeProbeHits <= 0) {
    try {
      const h = await deps.ragScopeHintJudge({
        userTask: input.userTask,
        stepQuery: input.baseQuery,
        probeSources: Array.isArray(probeRag?.sources) ? probeRag!.sources : [],
        probeSnippets: Array.isArray(probeRag?.snippets)
          ? probeRag!.snippets!.map((s) => String(s ?? ''))
          : []
      })
      scopeHint = h.catalogInstruction
      retrievalKeywords = h.retrievalKeywords
      excludeHints = h.excludeHints
    } catch {}
  }
  return buildRagRetrievalMessage(input.userTask, input.baseQuery, probeRag, scopeHint, {
    retrievalKeywords,
    excludeHints,
    turnScopeMode: input.turnScopeMode,
    turnKind: input.turnKind
  })
}

export function tryRagProbeSnippetFastPath(input: {
  leanRagQuery: string
  probeRag?: { hits?: number; sources?: string[]; snippets?: string[] } | null
}): { answer: string; evidence: Record<string, unknown> } | null {
  const hits = Number(input.probeRag?.hits ?? 0) || 0
  const snippets = (input.probeRag?.snippets ?? []).map((s) => String(s ?? '').trim()).filter(Boolean)
  if (hits <= 0 || !snippets.length) return null
  return buildAnswerFromProbeSnippets({
    query: input.leanRagQuery,
    probeSources: input.probeRag?.sources,
    probeSnippets: snippets,
    useAllProbeSnippets: true
  })
}

export function finishRagFastPath(
  input: { leanRagQuery: string; sendThinking: (t: string) => void; sendDelta?: (d: string) => void },
  opts: AgentExecutorOpts,
  probeRag: { hits?: number; sources?: string[]; snippets?: string[] } | null | undefined,
  fast: { answer: string; evidence: Record<string, unknown>; agentResult?: import('../../utils/agents/types').AgentResult },
  label: string
): AgentStepOutcome {
  input.sendThinking(label)
  input.sendDelta?.(fast.answer)
  opts.sendEvent({ event: 'delta', data: fast.answer, from: 'rag' })
  const evidenceUnits = countRagEvidenceUnits(fast.evidence, probeRag)
  return {
    ok: true,
    agent: 'rag',
    output: fast.answer,
    query: input.leanRagQuery,
    parsed: extractStructuredPayload(fast.answer),
    evidence: fast.evidence,
    meta: fast.agentResult ? { agentResult: fast.agentResult } : undefined,
    clarifyQuestions: evidenceUnits === 0 ? [...RAG_EMPTY_EVIDENCE_CLARIFY] : undefined
  }
}

export async function tryRagRetrieveAlignedPath(input: {
  state: ManagerGraphState
  question: string
  leanRagQuery: string
  managerRagTask?: ManagerRagTaskPayload | null
  probeRag?: { hits?: number; sources?: string[]; snippets?: string[] } | null
  opts: AgentExecutorOpts
  timeoutMs: number
  mode?: RagRetrieveAttemptMode
  ragEvidenceMatchJudge?: RagEvidenceMatchJudge
}): Promise<{ answer: string; evidence: Record<string, unknown>; agentResult?: import('../../utils/agents/types').AgentResult } | null> {
  const probeHits = Number(input.probeRag?.hits ?? 0) || 0
  const bypassJudge = shouldBypassRagEvidenceJudge(probeHits)
  const prefetch = input.state.meta?.ragRetrievePrefetch as RagRetrievePrefetchResult | undefined
  if (input.mode !== 'relaxed' && prefetch?.ok && Array.isArray(prefetch.evidence) && prefetch.evidence.length > 0 && !prefetch.needsClarify) {
    const judged = await judgeFilterRagEvidence(
      input.ragEvidenceMatchJudge,
      input.leanRagQuery,
      prefetch.evidence,
      { probeHits, bypassJudge: true }
    )
    if (judged.relevant && judged.rows.length) {
      const formatted = formatRagEvidenceAsManagerFacts(input.leanRagQuery, judged.rows)
      if (formatted) return formatted
    }
  }

  const callOpts = ragRetrieveCallOptions(input.mode ?? 'default', probeHits)
  const retrieveTimeout = probeHits > 0 ? Math.min(input.timeoutMs, 12_000) : Math.min(input.timeoutMs, 20_000)

  const data: RagRetrieveResponse | null =
    probeHits > 0 && input.mode !== 'relaxed'
      ? await callRagProbeAsRetrieve({
          ragAgentHttpUrl: input.opts.ragAgentHttpUrl,
          timeoutMs: retrieveTimeout,
          query: input.leanRagQuery,
          rawQuery: input.question,
          userId: input.opts.userId,
          traceId: input.opts.runId,
          signal: input.opts.signal
        })
      : await callRagRetrieve({
          ragAgentHttpUrl: input.opts.ragAgentHttpUrl,
          timeoutMs: retrieveTimeout,
          query: input.leanRagQuery,
          rawQuery: input.question,
          userId: input.opts.userId,
          traceId: input.opts.runId,
          managerRagTask: input.managerRagTask,
          skipLlmRerank: callOpts.skipLlmRerank,
          skipEvidenceSelect: callOpts.skipEvidenceSelect,
          signal: input.opts.signal
        })
  const rawEvidence = Array.isArray(data?.evidence) ? data!.evidence! : []
  const judged = await judgeFilterRagEvidence(input.ragEvidenceMatchJudge, input.leanRagQuery, rawEvidence, {
    probeHits,
    bypassJudge
  })
  if (!judged.rows.length || !judged.relevant || data?.needsClarify) return null
  const formatted = formatRagEvidenceAsManagerFacts(input.leanRagQuery, judged.rows)
  if (!formatted) return null
  return { ...formatted, agentResult: data?.agentResult }
}

