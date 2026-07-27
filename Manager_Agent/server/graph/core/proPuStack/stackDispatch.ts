export type { StepDispatchDraft } from './schemas'

import { z } from 'zod'
import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'
import type { ManagerInteractionMode } from '../../../utils/platform/managerInteractionMode'
import {
  clarifyThreshold,
  isProAmbiguityPolicyEnabled,
  isProUnderstandEnabled
} from '../../../utils/platform/managerInteractionMode'
import type { DataPlaneRoutingHint } from '../routing/dataPlaneRoutingHint'
import { shouldSuppressClarifyFromHint } from '../plan/clarifySuppress'
import {
  AmbiguitySchema,
  DataPlaneSchema,
  PreservedConstraintsSchema,
  StepDispatchDraftSchema,
  isProUnifiedPuStackEnabled,
  type PreservedConstraints,
  type StepDispatchDraft
} from './schemas'
import {
  type ProPuStackResult,
  mergeStepDispatchDraft,
  DATA_PLANE_AGENTS,
  DISPATCH_AGENTS,
  PLANE_DISPATCH_HINT,
  inferProPuStackUnified,
  inferProTaskShape,
  inferProDataPlane,
  inferProActionPlane,
  formatPuContextForActionPlane,
  invokeProJson,
  formatProPuStackHint
} from './stackInfer'

export function supplementPuStackDataPlaneDispatch(pu: ProPuStackResult): ProPuStackResult {
  let draft = mergeStepDispatchDraft(pu)
  const existing = new Set(draft.map((d) => String(d.agent)))
  const inferred = pu.dataPlane?.inferredDataSources ?? []

  for (const inf of inferred) {
    const plane = String(inf.plane || '').trim()
    const conf = Number(inf.confidence ?? 0)
    if (conf < 0.45 || !DISPATCH_AGENTS.has(plane) || existing.has(plane)) continue
    const scoped = String(inf.inferReason || PLANE_DISPATCH_HINT[plane] || plane)
      .trim()
      .slice(0, 480)
    if (scoped.length < 4) continue
    draft.push({ agent: plane, scopedUserLanguage: scoped, clauseIds: [`c${draft.length + 1}`] })
    existing.add(plane)
  }

  const hybridLike =
    pu.dataPlane?.taskIntent === 'hybrid' ||
    pu.taskShape?.taskShape === 'multi_source_parallel' ||
    inferred.filter((d) => DATA_PLANE_AGENTS.has(String(d.plane)) && Number(d.confidence ?? 0) >= 0.45).length >= 2
  const dataInDraft = draft.filter((d) => DATA_PLANE_AGENTS.has(String(d.agent))).length
  if (hybridLike && dataInDraft < 2) {
    for (const inf of inferred) {
      const plane = String(inf.plane || '').trim()
      const conf = Number(inf.confidence ?? 0)
      if (conf < 0.45 || !DATA_PLANE_AGENTS.has(plane) || existing.has(plane)) continue
      const scoped = String(inf.inferReason || PLANE_DISPATCH_HINT[plane] || plane)
        .trim()
        .slice(0, 480)
      if (scoped.length < 4) continue
      draft.push({ agent: plane, scopedUserLanguage: scoped, clauseIds: [`c${draft.length + 1}`] })
      existing.add(plane)
    }
  }

  if (!draft.length) return pu
  return {
    ...pu,
    actionPlane: {
      actionClauses: pu.actionPlane?.actionClauses ?? [],
      stepDispatchDraft: draft,
      confidence: pu.actionPlane?.confidence ?? 0.65
    }
  }
}

export function supplementPuStackAdminDispatch(pu: ProPuStackResult): ProPuStackResult {
  let draft = mergeStepDispatchDraft(pu)
  const inferred = pu.dataPlane?.inferredDataSources ?? []
  const wantsAdmin =
    pu.taskShape?.wantsAdmin === true ||
    inferred.some((d) => d.plane === 'admin' && d.confidence >= 0.45)

  if (wantsAdmin && !draft.some((d) => String(d.agent) === 'admin')) {
    const fromAction = pu.actionPlane?.actionClauses?.find((ac) => ac.kind === 'admin')
    const fromInfer = inferred.find((d) => d.plane === 'admin')
    const scoped = String(fromAction?.scopedText || fromInfer?.inferReason || '办公/出行/路线类事务')
      .trim()
      .slice(0, 480)
    if (scoped.length >= 4) {
      draft.push({ agent: 'admin', scopedUserLanguage: scoped, clauseIds: [`c${draft.length + 1}`] })
    }
  }

  if (!draft.length) return pu
  return {
    ...pu,
    actionPlane: {
      actionClauses: pu.actionPlane?.actionClauses ?? [],
      stepDispatchDraft: draft,
      confidence: pu.actionPlane?.confidence ?? 0.65
    }
  }
}

export function buildPuStackMetaPatch(pu: ProPuStackResult): Record<string, unknown> {
  const enriched = supplementPuStackAdminDispatch(supplementPuStackDataPlaneDispatch(pu))
  const meta: Record<string, unknown> = {}
  if (enriched.taskShape) {
    meta.taskShape = enriched.taskShape.taskShape
    meta.planShortcutHint = enriched.taskShape.planShortcut
    meta.requiresAgentPipelineHint = enriched.taskShape.requiresAgentPipeline
    if (enriched.taskShape.wantsVisualize) meta.wantsVisualizeHint = true
    if (enriched.taskShape.wantsReport) meta.wantsReportHint = true
    if (enriched.taskShape.wantsAdmin) meta.wantsAdminHint = true
  }
  if (enriched.dataPlane?.inferredDataSources?.length) {
    meta.inferredDataSources = enriched.dataPlane.inferredDataSources
  }
  if (enriched.dataPlane) {
    meta.dataPlaneTaskIntent = enriched.dataPlane.taskIntent
    meta.dataPlanePrimaryPlane = enriched.dataPlane.primaryPlane
    meta.dataPlaneConfidence = enriched.dataPlane.confidence
    meta.hasExplicitSubject = enriched.dataPlane.hasExplicitSubject
    meta.dataPlaneClarifyRisk = enriched.dataPlane.clarifyRisk
  }
  if (enriched.dataPlane?.preservedConstraints) {
    meta.preservedConstraints = enriched.dataPlane.preservedConstraints
  }
  const draft = mergeStepDispatchDraft(enriched)
  if (draft.some((d) => String(d.agent) === 'admin')) meta.wantsAdminHint = true
  if (
    enriched.dataPlane?.inferredDataSources?.some(
      (d) => d.plane === 'admin' && Number(d.confidence ?? 0) >= 0.45
    )
  ) {
    meta.wantsAdminHint = true
  }
  if (draft.length) meta.stepDispatchDraft = draft
  return meta
}

function mergeAmbiguityWithDataPlane(
  dataPlane: z.infer<typeof DataPlaneSchema> | undefined,
  ambiguity: z.infer<typeof AmbiguitySchema> | undefined
): z.infer<typeof AmbiguitySchema> | undefined {
  if (!dataPlane) return ambiguity
  const hint: DataPlaneRoutingHint = {
    taskIntent: dataPlane.taskIntent,
    primaryPlane: dataPlane.primaryPlane,
    hasExplicitSubject: dataPlane.hasExplicitSubject,
    clarifyRisk: dataPlane.clarifyRisk,
    confidence: dataPlane.confidence
  }
  if (
    shouldSuppressClarifyFromHint(hint) &&
    (dataPlane.hasExplicitSubject || dataPlane.clarifyRisk === 'none' || dataPlane.clarifyRisk === 'low')
  ) {
    return {
      policy: 'proceed',
      needsClarify: false,
      clarifyQuestions: [],
      defaultAssumptions: ambiguity?.defaultAssumptions ?? [],
      confidence: Math.max(dataPlane.confidence, ambiguity?.confidence ?? 0.65)
    }
  }
  return ambiguity
}

export async function runProfessionalPuStack(input: {
  interactionMode: ManagerInteractionMode
  lastUser: string
  routingContext?: string
  probeHint?: string
  llmInvoke: LlmInvokeFn
  state: unknown
  skipAmbiguity?: boolean
  onParseFail?: (detail: string) => void
}): Promise<ProPuStackResult | null> {
  if (input.interactionMode !== 'professional' || !isProUnderstandEnabled()) return null

  if (isProUnifiedPuStackEnabled()) {
    const unified = await inferProPuStackUnified({
      ...input,
      onParseFail: input.onParseFail
    }).catch(() => null)
    if (unified) {
      const merged = supplementPuStackAdminDispatch(supplementPuStackDataPlaneDispatch(unified))
      merged.hintBlock = formatProPuStackHint(merged)
      if (!input.skipAmbiguity) {
        const ambiguity = await inferProAmbiguityPolicy({
          lastUser: input.lastUser,
          dataPlaneConfidence: merged.dataPlane?.confidence,
          llmInvoke: input.llmInvoke,
          state: input.state
        }).catch(() => null)
        merged.ambiguity = mergeAmbiguityWithDataPlane(merged.dataPlane, ambiguity ?? undefined)
      }
      return merged
    }
  }

  const taskShape = await inferProTaskShape(input)
  const dataPlane = await inferProDataPlane(input)
  const actionPlane = await inferProActionPlane({
    ...input,
    clausesHint: [input.routingContext, formatPuContextForActionPlane(dataPlane, taskShape)]
      .filter(Boolean)
      .join('\n\n')
  })
  const ambiguity = input.skipAmbiguity
    ? null
    : await inferProAmbiguityPolicy({
        lastUser: input.lastUser,
        dataPlaneConfidence: dataPlane?.confidence,
        llmInvoke: input.llmInvoke,
        state: input.state
      })
  const merged = supplementPuStackAdminDispatch(
    supplementPuStackDataPlaneDispatch({
      taskShape: taskShape ?? undefined,
      dataPlane: dataPlane ?? undefined,
      actionPlane: actionPlane ?? undefined,
      ambiguity: mergeAmbiguityWithDataPlane(dataPlane ?? undefined, ambiguity ?? undefined),
      hintBlock: ''
    })
  )
  merged.hintBlock = formatProPuStackHint(merged)
  return merged
}

export async function inferProAmbiguityPolicy(input: {
  lastUser: string
  dataPlaneConfidence?: number
  llmInvoke: LlmInvokeFn
  state: unknown
}): Promise<z.infer<typeof AmbiguitySchema> | null> {
  if (!isProAmbiguityPolicyEnabled()) return null
  const q = String(input.lastUser || '').trim()
  if (q.length < 4) return null
  const th = clarifyThreshold()
  return invokeProJson(
    AmbiguitySchema,
    [
      '你是 AmbiguityPolicy 推断器。',
      `confidence < ${th} 且缺范围 → clarify`,
      'schema: {"policy":"...","needsClarify":bool,"clarifyQuestions":[],"defaultAssumptions":[],"confidence":0~1}'
    ].join('\n'),
    q,
    input.llmInvoke,
    input.state
  )
}

export function preservedConstraintsFromMeta(meta: unknown): PreservedConstraints | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = (meta as Record<string, unknown>).preservedConstraints
  const parsed = PreservedConstraintsSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function stepDispatchDraftFromMeta(meta: unknown): StepDispatchDraft[] {
  if (!meta || typeof meta !== 'object') return []
  const raw = (meta as Record<string, unknown>).stepDispatchDraft
  if (!Array.isArray(raw)) return []
  return raw
    .map((x) => StepDispatchDraftSchema.safeParse(x))
    .filter((p) => p.success)
    .map((p) => p.data)
}

const DISPATCH_EXEC_AGENTS = new Set([
  'db',
  'rag',
  'code',
  'crawler',
  'gui',
  'admin',
  'clean',
  'visualize',
  'report',
  'multimodal',
  'music',
  'video'
])

/** userIntentAlign 后：按对齐 clauses 重建 stepDispatchDraft，保留仍匹配的 prior scoped 文本 */
export function rebuildStepDispatchDraftFromClauses(input: {
  clauses: Array<{ id: string; text: string; agents?: string[] }>
  allowedAgents: string[]
  priorDraft?: StepDispatchDraft[]
}): StepDispatchDraft[] {
  const allowed = new Set(input.allowedAgents.map(String))
  const priorByAgent = new Map<string, StepDispatchDraft>()
  for (const d of input.priorDraft ?? []) {
    const a = String(d.agent || '').trim()
    if (a && !priorByAgent.has(a)) priorByAgent.set(a, d)
  }
  const out: StepDispatchDraft[] = []
  const seen = new Set<string>()

  for (const c of input.clauses) {
    const text = String(c.text || '').trim().slice(0, 480)
    if (text.length < 2) continue
    const agents = (c.agents ?? []).filter((a) => allowed.has(String(a)) && DISPATCH_EXEC_AGENTS.has(String(a)))
    for (const agent of agents) {
      const key = String(agent)
      if (seen.has(key)) continue
      seen.add(key)
      const prior = priorByAgent.get(key)
      const clauseMatch = prior?.clauseIds?.includes(c.id)
      const scoped =
        clauseMatch && String(prior?.scopedUserLanguage || '').trim().length >= 2
          ? String(prior!.scopedUserLanguage).trim().slice(0, 480)
          : text
      out.push({
        agent: key,
        scopedUserLanguage: scoped,
        clauseIds: [c.id],
        attachedConstraints: prior?.attachedConstraints
      })
    }
  }

  for (const a of input.allowedAgents) {
    const key = String(a)
    if (seen.has(key) || !DISPATCH_EXEC_AGENTS.has(key)) continue
    const prior = priorByAgent.get(key)
    if (String(prior?.scopedUserLanguage || '').trim().length >= 2) {
      out.push({
        agent: key,
        scopedUserLanguage: String(prior!.scopedUserLanguage).trim().slice(0, 480),
        clauseIds: prior!.clauseIds,
        attachedConstraints: prior!.attachedConstraints
      })
      seen.add(key)
    }
  }

  return out.filter((d) => String(d.scopedUserLanguage || '').trim().length >= 2)
}

