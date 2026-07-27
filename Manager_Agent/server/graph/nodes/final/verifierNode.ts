import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { effectiveUserTask } from '../../core/text'
import { z } from 'zod'
import type { Intent } from '../../../utils/shared/taskPlan'
import {
  buildCompositeMediaFinal,
  inferMediaPlanAgents,
  isMediaOnlyPlanAgents,
  textHasPlayableMediaUrl,
  isSynthRejectingMedia,
  mediaAgentsInPlan,
  pickPrimaryResultText,
  type StructuredFact
} from '../../core/shared'
import { recordPolicyRolloutBaseline } from '../../core/evolution/policyRollout'
import { buildGovernanceSnapshot, writeGovernanceSnapshot } from '../../core/evolution/governance'
import { isExperienceReplayEnabled } from '../../core/memory/experienceReplay'
import { indexMemoryEntry, isVectorMemoryEnabled } from '../../core/memory/vectorMemory'
import { runEvolutionExperimentCycle } from '../../core/evolution/evolutionExperiments'
import { updateUserProfileFromRun } from '../../core/memory/userProfile'
import { recordLayeredMemoryFromRun } from '../../core/layeredMemory'
import { recordUnifiedLearningFromRun } from '../../core/unifiedLearning'
import { interactionModeFromMeta } from '../../core/runtime/modeIsolate'
import { inferManagerRouteMatrixPass } from '#agent-shared/evolutionConvergence'
import { recordToolMemoryEvent } from '#agent-shared/toolMemoryStore'
import { isAgentToolSuccess, isSkillDraftEligible } from '#agent-shared/agentOutcomePolicy'
import { syncDbExperienceFromManagerRun } from '#agent-shared/dbExperienceBridge'
import { syncRagExperienceFromManagerRun } from '#agent-shared/ragExperienceBridge'
import { syncAdminExperienceFromManagerRun } from '#agent-shared/adminExperienceBridge'
import { syncCodeExperienceFromManagerRun } from '#agent-shared/codeExperienceBridge'
import { syncCrawlerExperienceFromManagerRun } from '#agent-shared/crawlerExperienceBridge'
import { syncGuiExperienceFromManagerRun } from '#agent-shared/guiExperienceBridge'
import { captureRunArtifactsFromState } from '#agent-shared/artifactRunCapture'
import { saveShadowRunArtifacts } from '#agent-shared/artifactFeedbackOrchestrator'
import { hashSql } from '#agent-shared/artifactStore'
import { isFederationFeedbackGated } from '#agent-shared/artifactFeedbackPolicy'
import { upsertProcessMemory } from '#agent-shared/processMemoryStore'
import { upsertKgFromManagerRun } from '#agent-shared/kgMemoryStore'
import { maybeAutoDraftSkillFromSuccess } from '../../../utils/skills/skillDraftAuto'
import {
  qualifiesSkillAutoDraft,
  refineExperienceWrite,
  isStrictExperienceWriteEnabled,
  shouldIndexExperienceMemory
} from '../../core/memory/experienceWritePolicy'
import { extractSearchRunMetrics, searchMetricsForLearning } from '../../../utils/search/managerSearchMetrics'
import { buildSerpDirectSynthBlock } from '../../../utils/search/managerWebDirectSynth'
import { formatChatWebSynthHint, shouldForceChatWebDirectSynth } from '../../../utils/chat/managerChatWeb'
import { buildEchartsOptionBlock, ensureVisualizeBlocksInFinal } from '../../core/output/finalOutputBlocks'
import { extractTaggedBlockFull, wrapTaggedBlock } from '../../../utils/shared/outputMarkers'
import { CODE_AUTHORITY_CRITIC_RULE, CODE_AUTHORITY_SYNTH_RULE, REPORT_SYNTH_ALIGNMENT_CRITIC_RULE, REPORT_SYNTH_ALIGNMENT_SYNTH_RULE, hasCodeInResults } from '#agent-shared/codeFirstAuthority'
import { parseCleanPayload } from '#agent-shared/cleanPayload'
import {
  hasDeterministicReportEvidence,
  shouldPassthroughDbOnly,
  shouldPassthroughDeterministicReport
} from '#agent-shared/deterministicPassthrough'
import { isMultiSourceDataPipeline } from '#agent-shared/dbPipelineDeterministic'
import { resolveSynthShapeSignals } from '#agent-shared/synthShapePolicy'
import { buildDeferredReportFromSynth } from '#agent-shared/deferredReportBlock'
import { maybeCompleteTaskStackFromRun } from '../../core/task/taskStackFinalize'
import {
  assessEvidenceGate,
  hasDbEvidenceInRun
} from '../../core/db/evidenceGate'
import {
  criticRetryContradictsRunEvidence,
  formatEvaluatorForCriticAudit,
  formatEvidenceForCriticAudit
} from '../../core/output/criticEvidence'
import { shouldSkipCriticLlm } from '../../core/output/criticPolicy'
import { loadTaskStack } from '../../core/task/taskStack'
import { extractAndUpsertTasksFromAssistantText, isTaskStackFinalizeLlmExtractEnabled } from '../../core/task/taskStackLlmExtract'
import {
  extractCrawlerItems,
  extractCrawlerTableMarkdown,
  parseCrawlerPayload,
} from '../../../utils/crawler/managerCrawlerTaskPayload'
import { buildCrawlerSourcesTaggedBlock, resolveCrawlerTableMarkdown, extractCrawlerItemsFromText } from '../../../utils/crawler/crawlerItemsParse'
import { pickRicherNarrativeWithAuxBlocks, extractAuxBlocksStructural } from '#agent-shared/auxBlocks'
import { polishFinalPayload } from '../../core/output/replyPolish'
import { isReportDeferredToSynth } from '#agent-shared/reportSynthDefer'
import { stripSynthPromptLeakage } from '#agent-shared/synthOutputSanitize'
import { sanitizeVisionAnswer } from '../../../utils/media/managerVisionSanitize'
import { formatAgentResultSourcesForSynth } from '../../../utils/agents/agentResult'
import { assessCodeDownstreamConsistencyAsync } from '../../../utils/code/managerCodeAuthorityNormalize'
import { isManagerSynthStreamEnabled } from '../../core/runtime/runtime'
import type { LlmInvokeOptions } from '../../core/shared/modelTier'
import { resolveManagerInteractionMode } from '../../../utils/platform/managerInteractionMode'
import { buildCodeFirstBundle } from '#agent-shared/codeFirstAuthority'
import { createCodeAuthorityLlmModel } from '../../../utils/code/managerCodeAuthorityLlm'
import { repairCodeAuthorityVisualize } from '../../../utils/code/managerCodeDownstream'
import { canManagerRetryMore, resolveManagerRetryLimits } from '../../core/runtime/retryBudget'
import type { CreateFinalNodesDeps } from './types'
import { CriticVerdictSchema, type CriticVerdict } from './schemas'
import { mergeSynthFinalWithReportBody, appendDeferredReportBlockIfNeeded } from './helpers'
import {
  assessVerifierCompletion,
  collectStepObservations
} from '../../core/output/verifierCompletion'

export function buildVerifierNode(deps: CreateFinalNodesDeps) {
  const {
    ensureNotAborted,
    opts,
    llmInvoke,
    lastUserText,
    runAlwaysInternalCollaborators,
    extractStructuredPayload,
    sanitizeUntrustedText,
    formatReferences,
    stripLatexMath,
    summarize,
    mergeMeta,
    getEffectivePlanSteps,
    timeLeftMs,
    policyPromise,
    defaultPolicy,
    appendMemory,
    appendNluMetrics,
    maybeUpdateManagerPolicy,
    policyDir,
    readFeedbackForRun,
    clampNumber,
    deriveScenarioKey,
    uncertaintyFromConfidence,
    normalizeFinalUserText,
    redactSecrets,
    safeJsonParse,
    IntentSchema
  } = deps

  function finishVerifierMeta(
    state: any,
    patch: Record<string, unknown>,
    resources?: unknown
  ) {
    const plan = getEffectivePlanSteps(state as any)
    const stepRecords = collectStepObservations({
      plan,
      meta: { ...(state.meta || {}), ...patch }
    })
    const verdict = assessVerifierCompletion({
      intent: String(state.intent || ''),
      plan,
      stepRecords,
      evidence: Array.isArray(state.evidence) ? state.evidence : [],
      evidenceSupportedClaimRate:
        typeof patch.evidenceSupportedClaimRate === 'number'
          ? Number(patch.evidenceSupportedClaimRate)
          : typeof state.meta?.evidenceSupportedClaimRate === 'number'
            ? Number(state.meta.evidenceSupportedClaimRate)
            : null,
      unsupportedClaims: Array.isArray(patch.unsupportedClaims)
        ? (patch.unsupportedClaims as string[])
        : Array.isArray(state.meta?.unsupportedClaims)
          ? state.meta.unsupportedClaims
          : [],
      meta: { ...(state.meta || {}), ...patch }
    })
    const next = {
      ...patch,
      ...(stepRecords.length ? { lastStepRecords: stepRecords } : {}),
      ...(verdict ? { verifierVerdict: verdict } : {})
    }
    if (verdict && verdict.verdict !== 'pass') {
      opts.sendEvent({
        event: 'thinking',
        data: `Verifier 完成判定：${verdict.verdict} → ${verdict.outcome}${verdict.note ? `（${verdict.note}）` : ''}`,
        from: 'manager'
      })
    }
    const out: Record<string, unknown> = { meta: mergeMeta(state, next) }
    if (resources) out.resources = resources
    return out
  }

  return async (state: any) => {
      ensureNotAborted()
      opts.sendEvent({ event: 'phase', data: 'verifier', from: 'manager' })
      const finalText = String(state.final || '').trim()
      if (!finalText) {
        return finishVerifierMeta(state, {})
      }
      const evidence = Array.isArray(state.evidence) ? state.evidence : []
      const evidenceKinds = Array.from(new Set(evidence.map((e: any) => String(e?.kind || '')).filter(Boolean)))
      const hasAnyEvidence = evidenceKinds.length > 0
      const hasRagEvidence = evidence.some((e: any) => String(e?.kind || '') === 'rag' && Array.isArray(e?.citations) && e.citations.length > 0)
      const hasNumbers = /\d/.test(finalText)
      const shortAnswer = finalText.length <= 2200
      const nearDeadline = timeLeftMs(state.resources) < 12_000
      if ((hasRagEvidence && hasNumbers && shortAnswer) || nearDeadline) {
        const rate = hasRagEvidence ? 0.9 : 0.75
        const reason = nearDeadline ? '接近超时，启用快速核验' : '证据充分，启用快速核验'
        opts.sendEvent({ event: 'thinking', data: `Verifier Fast Path：${reason}`, from: 'manager' })
        return finishVerifierMeta(state, { evidenceSupportedClaimRate: rate, unsupportedClaims: [] })
      }
      if (!hasAnyEvidence) {
        return finishVerifierMeta(state, {
          evidenceSupportedClaimRate: 0,
          unsupportedClaims: ['（无 evidence）']
        })
      }
      const evSnippets: string[] = []
      for (const e of evidence.slice(0, 6)) {
        const kind = String(e?.kind || 'unknown')
        if (kind === 'rag') {
          const citations = Array.isArray(e?.citations) ? e.citations : []
          const top = citations.slice(0, 3).map((c: any) => String(c?.source || c?.title || c?.url || '').trim()).filter(Boolean)
          evSnippets.push(`rag(query=${String(e?.query || '').slice(0, 120)}; cites=${top.join('|') || 'n/a'})`)
        } else if (kind === 'db') {
          evSnippets.push(`db(query=${String(e?.query || '').slice(0, 120)}; empty=${Boolean(e?.empty)}; run_id=${String(e?.run_id || '')})`)
        } else if (kind === 'crawler') {
          evSnippets.push(`crawler(query=${String(e?.query || '').slice(0, 120)})`)
        } else if (kind === 'code') {
          evSnippets.push(`code(threadId=${String(e?.threadId || '')}; query=${String(e?.query || '').slice(0, 120)})`)
        } else {
          evSnippets.push(`${kind}`)
        }
      }
      const stepObs = collectStepObservations({
        plan: getEffectivePlanSteps(state as any),
        meta: state.meta
      })
      const obsLines = stepObs
        .slice(0, 8)
        .map(
          (o) =>
            `${o.id}[${o.agent}]=${o.status}${o.error ? ` err=${String(o.error).slice(0, 80)}` : ''}`
        )
      const VerifySchema = z.object({
        supportedRate: z.number().min(0).max(1),
        unsupportedClaims: z.array(z.string()).default([]),
        supportedClaims: z.array(z.string()).default([])
      })
      const prompt = [
        new SystemMessage(
          [
            '你是一个事实核验器。任务：把最终回答拆成若干“可核验的 claims”，并检查每条 claim 是否被 evidence 与 Step Observation 支持。',
            '',
            '规则：',
            '- evidence 与步状态是唯一可用依据；不允许凭空推测。',
            '- 只抽取 6-10 条最关键 claims（数字/日期/结论/对比）。',
            '- 输出严格 JSON：{ supportedRate: 0..1, unsupportedClaims: string[], supportedClaims: string[] }',
            '- supportedRate = supportedClaims / (supportedClaims + unsupportedClaims)（四舍五入到 2 位即可）。'
          ].join('\n')
        ),
        new HumanMessage(
          [
            `最终回答：\n${finalText.slice(0, 4500)}`,
            '',
            `Step Observation：\n- ${obsLines.join('\n- ') || '（无）'}`,
            '',
            `evidence 摘要：\n- ${evSnippets.join('\n- ')}`
          ].join('\n')
        )
      ]
      try {
        const r = await llmInvoke('verifier', state, prompt, { tier: 'standard' })
        const parsed = VerifySchema.safeParse(safeJsonParse(String(r.text ?? '')))
        if (parsed.success) {
          const v = parsed.data
          const rate = Math.max(0, Math.min(1, Number(v.supportedRate)))
          return finishVerifierMeta(
            { ...state, meta: r.meta ?? state.meta },
            { evidenceSupportedClaimRate: rate, unsupportedClaims: v.unsupportedClaims.slice(0, 10) },
            r.resources
          )
        }
      } catch {}
      // LLM 失败：不 silent 编造高分通过；仅给中性 rate，完成判定由 Observation 决定
      return finishVerifierMeta(state, {
        evidenceSupportedClaimRate: hasAnyEvidence ? 0.5 : 0,
        unsupportedClaims: hasAnyEvidence ? [] : ['（无 evidence）']
      })
    }

    function sanitizeVisionIfNeeded(text: string, state: any): string {
      const mm = String(state?.results?.multimodal || '').trim()
      if (!mm && String(state?.intent ?? '') !== 'multimodal') return String(text || '')
      const userTask = effectiveUserTask(state.messages as any, state.routedQuery)
      return sanitizeVisionAnswer(String(text || ''), userTask)
    }

    function composeStreamAlignedFinal(state: any): string {
      const stream = String(state.meta?.synthStreamBody ?? '').trim()
      const stored = String(state.final ?? '').trim()
      let body = pickRicherNarrativeWithAuxBlocks(stream, stored)
      body = stripSynthPromptLeakage(body)
      const reportBody = String(state?.results?.report || '').trim()
      body = mergeSynthFinalWithReportBody(body, reportBody)
      const steps = getEffectivePlanSteps(state as any)
      const plannedReport = steps.some((s: any) => String(s?.agent || '') === 'report')
      const plannedViz = steps.some((s: any) => String(s?.agent || '') === 'visualize')
      const hasVizEvidence = (Array.isArray(state.evidence) ? state.evidence : []).some(
        (e: any) => String(e?.kind ?? '') === 'visualize'
      )
      const directVisualize =
        plannedViz || hasVizEvidence ? String(state?.results?.visualize || '').trim() : ''
      body = ensureVisualizeBlocksInFinal(body, directVisualize, (state?.results || {}) as Record<string, string>)
      const cur = String(body || '')
      if (!extractCrawlerTableMarkdown(cur)) {
        const block = buildCrawlerSourcesTaggedBlock(state?.results?.crawler)
        if (block) body = `${cur}\n\n${block}`
      }
      const question = effectiveUserTask(state.messages as any, state.routedQuery)
      body = appendDeferredReportBlockIfNeeded({
        body,
        synthSource: stream || extractAuxBlocksStructural(body).narrative,
        results: (state?.results || {}) as Record<string, unknown>,
        evidence: Array.isArray(state.evidence) ? state.evidence : [],
        plannedReport,
        shapeCtx: { meta: state.meta, planSteps: state.plan }
      })
      return polishFinalPayload(
        stripLatexMath(normalizeFinalUserText(sanitizeVisionIfNeeded(String(body || '').trim(), state)))
      )
    }

}
