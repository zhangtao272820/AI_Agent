/**
 * PU-Stack 产出并入统一编排 bundle
 */
import type { TaskClause } from '../core/routing/clauses'
import { sortAgentsByPipelineOrder, ensureCodeInPipelineAgents } from '../core/routing/clauses'
import type { ExecutableAgent } from '../core/routing/routeFinalize'
import type { TaskOrchestratorBundle } from '../llm/taskOrchestrator'
import { stepDispatchDraftFromMeta, type StepDispatchDraft } from '../core/proPuStack'
import { hasPuStackCompositeHint } from '../core/routing/proRoutePolicy'

const DATA_PLANE = new Set(['rag', 'db', 'crawler'])
const ACTION_AGENTS = new Set(['admin', 'gui'])
const PIPELINE_AGENTS = new Set(['clean', 'code', 'visualize', 'report'])
const EXEC = new Set([
  'rag', 'db', 'crawler', 'clean', 'code', 'visualize', 'report', 'admin', 'gui',
  'multimodal', 'music', 'video'
])

function draftToClauses(draft: StepDispatchDraft[]): TaskClause[] {
  return draft.map((d, i) => ({
    id: String(d.clauseIds?.[0] || `c${i + 1}`),
    text: String(d.scopedUserLanguage || '').trim().slice(0, 480),
    layer: DATA_PLANE.has(String(d.agent)) ? ('data' as const) : String(d.agent) === 'admin' ? ('action' as const) : undefined,
    agents: EXEC.has(String(d.agent)) ? ([String(d.agent)] as TaskClause['agents']) : []
  }))
}

function optionalAgentsFromMeta(meta: Record<string, unknown>): ExecutableAgent[] {
  const out: ExecutableAgent[] = []
  if (meta.wantsAdminHint === true) out.push('admin')
  const raw = meta.inferredDataSources
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (!x || typeof x !== 'object') continue
      const plane = String((x as { plane?: string }).plane || '')
      const conf = Number((x as { confidence?: number }).confidence ?? 0)
      if (conf >= 0.45 && ACTION_AGENTS.has(plane)) out.push(plane as ExecutableAgent)
    }
  }
  return [...new Set(out)]
}

function preserveOptionalAgents(allowed: ExecutableAgent[], sources: Iterable<ExecutableAgent>): ExecutableAgent[] {
  const out = [...allowed]
  for (const a of sources) {
    if (ACTION_AGENTS.has(String(a)) && !out.includes(a)) out.push(a)
  }
  return out
}

function agentsFromDraft(draft: StepDispatchDraft[]): ExecutableAgent[] {
  const seen = new Set<string>()
  const out: ExecutableAgent[] = []
  for (const d of draft) {
    const a = String(d.agent || '').trim()
    if (!a || !EXEC.has(a) || seen.has(a)) continue
    seen.add(a)
    out.push(a as ExecutableAgent)
  }
  return out
}

export function shouldPreferFullOrchestrator(state: unknown): boolean {
  if (!state || typeof state !== 'object') return false
  const m = (state as { meta?: Record<string, unknown> }).meta
  if (!m) return false
  return hasPuStackCompositeHint(m)
}

export function mergePuStackIntoOrchestratorBundle(
  bundle: TaskOrchestratorBundle,
  meta: unknown
): TaskOrchestratorBundle {
  const draft = stepDispatchDraftFromMeta(meta)
  if (draft.length < 2) return bundle
  const clauses = draftToClauses(draft)
  let allowed = agentsFromDraft(draft)
  const metaObj = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>
  allowed = preserveOptionalAgents(allowed, [
    ...bundle.allowedAgents.filter((a) => ACTION_AGENTS.has(String(a))),
    ...optionalAgentsFromMeta(metaObj)
  ])
  const wantsPipeline =
    metaObj.requiresAgentPipelineHint === true ||
    metaObj.wantsVisualizeHint === true ||
    metaObj.wantsReportHint === true ||
    metaObj.taskShape === 'multi_source_parallel' ||
    bundle.intentClassify.requiresAgentPipeline === true
  if (wantsPipeline) {
    for (const a of bundle.allowedAgents) {
      if (PIPELINE_AGENTS.has(String(a)) && !allowed.includes(a)) allowed.push(a)
    }
    if (metaObj.wantsVisualizeHint === true || bundle.intentClassify.explicitWantsVisualize) {
      for (const a of ['clean', 'code', 'visualize'] as ExecutableAgent[]) {
        if (!allowed.includes(a)) allowed.push(a)
      }
    }
    if (metaObj.wantsReportHint === true || bundle.intentClassify.explicitWantsReport) {
      for (const a of ['code', 'report'] as ExecutableAgent[]) {
        if (!allowed.includes(a)) allowed.push(a)
      }
    }
    allowed = ensureCodeInPipelineAgents(sortAgentsByPipelineOrder(allowed)) as ExecutableAgent[]
  } else {
    allowed = sortAgentsByPipelineOrder(allowed) as ExecutableAgent[]
  }
  let finalClauses = clauses
  if (allowed.includes('admin') && !finalClauses.some((c) => c.agents?.includes('admin'))) {
    const adminDraft = draft.find((d) => String(d.agent) === 'admin')
    if (adminDraft) finalClauses = [...finalClauses, ...draftToClauses([adminDraft])]
  }
  const dataSources = [...new Set(allowed.filter((a) => DATA_PLANE.has(String(a))))] as Array<'rag' | 'db' | 'crawler'>
  const needsAdmin = allowed.includes('admin')
  return {
    ...bundle,
    clauses: finalClauses,
    allowedAgents: allowed,
    intent: allowed.length >= 2 ? 'multi' : String(allowed[0] || bundle.intent),
    intentClassify: {
      ...bundle.intentClassify,
      isMulti: allowed.length >= 2 || finalClauses.length >= 2,
      isDbAnchored: allowed.includes('db'),
      needsAdmin,
      dataSources: dataSources.length ? dataSources : bundle.intentClassify.dataSources,
      suggestedAgents: allowed,
      requiresAgentPipeline: allowed.some((a) => PIPELINE_AGENTS.has(String(a))),
      planShortcut: 'none'
    },
    raw: {
      ...bundle.raw,
      clauses: finalClauses,
      allowedAgents: allowed,
      suggestedAgents: allowed,
      isDbAnchored: allowed.includes('db'),
      needsAdmin,
      dataSources,
      isMulti: finalClauses.length >= 2 || allowed.length >= 2
    }
  }
}
