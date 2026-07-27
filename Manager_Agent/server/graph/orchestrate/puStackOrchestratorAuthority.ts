/**
 * PU-Stack LLM 产出作为复合任务编排权威（Plan-and-Execute 第一层）
 */
import type { TurnRoutingScope } from '../core/routing/turnScope'
import { ensureCodeInPipelineAgents, sortAgentsByPipelineOrder } from '../core/routing/clauses'
import type { ExecutableAgent } from '../core/routing/routeFinalize'
import { reconcileIntentClassifyDataPlane } from './routeOrchestration'
import {
  buildOrchestratorBundleFromClassify,
  type TaskOrchestratorBundle
} from '../llm/taskOrchestrator'
import { mergePuStackIntoOrchestratorBundle } from './puStackOrchestratorMerge'
import { dataPlaneRoutingHintFromMeta } from '../core/routing/dataPlaneRoutingHint'
import { stepDispatchDraftFromMeta, preservedConstraintsFromMeta } from '../core/proPuStack'
import { isProbeDbRoutingRelevant, type ProbeDbSlice } from '../core/probe/probeInterpretation'

const DATA_PLANE = new Set(['rag', 'db', 'crawler'])
const EXEC = new Set(['rag', 'db', 'crawler', 'clean', 'code', 'visualize', 'report', 'admin', 'gui', 'multimodal', 'music', 'video'])

function inferredPlanesFromMeta(meta: Record<string, unknown>, minConf = 0.5): ExecutableAgent[] {
  const raw = meta.inferredDataSources
  if (!Array.isArray(raw)) return []
  const out: ExecutableAgent[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const plane = String((x as { plane?: string }).plane || '')
    const conf = Number((x as { confidence?: number }).confidence ?? 0)
    if (conf >= minConf && EXEC.has(plane)) out.push(plane as ExecutableAgent)
  }
  return [...new Set(out)]
}

export function downstreamAgentsFromPuTaskShape(meta: Record<string, unknown>): ExecutableAgent[] {
  const out = new Set<string>()
  const requiresPipeline =
    meta.requiresAgentPipelineHint === true ||
    meta.taskShape === 'multi_source_parallel' ||
    meta.taskShape === 'linear_pipeline'
  if (requiresPipeline) {
    out.add('clean')
    out.add('code')
  }
  if (meta.wantsVisualizeHint === true || meta.planShortcutHint === 'db_chart') {
    out.add('visualize')
    out.add('code')
    out.add('clean')
  }
  if (meta.wantsReportHint === true) {
    out.add('report')
    out.add('code')
  }
  if (meta.wantsAdminHint === true) out.add('admin')
  const pc = preservedConstraintsFromMeta(meta)
  const outputFormat = String(pc?.outputFormat || '').trim().toLowerCase()
  if (outputFormat.includes('chart') || outputFormat.includes('visual')) {
    out.add('visualize')
    out.add('code')
    out.add('clean')
  }
  if (outputFormat.includes('report')) {
    out.add('report')
    out.add('code')
  }
  return [...out].filter((a) => EXEC.has(a)) as ExecutableAgent[]
}

export function capFloorFromPuStackMeta(
  meta: unknown,
  probe?: { db?: ProbeDbSlice; rag?: { hits?: number } } | null
): ExecutableAgent[] {
  if (!meta || typeof meta !== 'object') return []
  const m = meta as Record<string, unknown>
  const out = new Set<string>()
  for (const d of stepDispatchDraftFromMeta(m)) {
    const a = String(d.agent || '').trim()
    if (EXEC.has(a)) out.add(a)
  }
  for (const a of inferredPlanesFromMeta(m, 0.45)) out.add(String(a))
  for (const a of downstreamAgentsFromPuTaskShape(m)) out.add(String(a))
  if (m.wantsAdminHint === true) out.add('admin')
  if (m.wantsVisualizeHint === true) {
    out.add('visualize')
    out.add('code')
    out.add('clean')
  }
  return sortAgentsByPipelineOrder([...out] as ExecutableAgent[]) as ExecutableAgent[]
}

export function isPuStackOrchestratorAuthority(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false
  const m = meta as Record<string, unknown>
  if (stepDispatchDraftFromMeta(m).length >= 2) return true
  const hint = dataPlaneRoutingHintFromMeta(m)
  if (hint?.taskIntent === 'hybrid' && hint.confidence >= 0.55) return true
  if (m.taskShape === 'multi_source_parallel') return true
  return inferredPlanesFromMeta(m).filter((p) => DATA_PLANE.has(String(p))).length >= 2
}

export function resolvePuStackOrchestratorAgents(
  meta: Record<string, unknown>,
  probe?: { db?: ProbeDbSlice; rag?: { hits?: number } } | null
): ExecutableAgent[] {
  let agents = capFloorFromPuStackMeta(meta, probe)
  const requiresPipeline =
    meta.requiresAgentPipelineHint === true ||
    meta.taskShape === 'multi_source_parallel' ||
    meta.taskShape === 'linear_pipeline' ||
    dataPlaneRoutingHintFromMeta(meta)?.taskIntent === 'hybrid'
  if (requiresPipeline && agents.some((a) => DATA_PLANE.has(String(a)))) {
    agents = ensureCodeInPipelineAgents(agents) as ExecutableAgent[]
  }
  return sortAgentsByPipelineOrder(agents) as ExecutableAgent[]
}

export function buildOrchestratorBundleFromPuStack(input: {
  lastUser: string
  turnScope: TurnRoutingScope
  meta: Record<string, unknown>
  probe?: { db?: ProbeDbSlice; rag?: { hits?: number } } | null
}): TaskOrchestratorBundle | null {
  if (!isPuStackOrchestratorAuthority(input.meta)) return null
  const last = String(input.lastUser || '').trim()
  if (last.length < 4) return null
  const agents = resolvePuStackOrchestratorAgents(input.meta, input.probe)
  if (!agents.length) return null
  const dataSources = [...new Set(agents.filter((a) => DATA_PLANE.has(String(a))))] as Array<'rag' | 'db' | 'crawler'>
  const wantsPipeline = agents.some((a) => ['clean', 'code', 'visualize', 'report'].includes(String(a)))
  const empty = buildOrchestratorBundleFromClassify({
    classify: reconcileIntentClassifyDataPlane({
      primaryIntent: agents.length === 1 ? (agents[0] as 'rag' | 'db') : 'multi',
      isMulti: agents.length >= 2 || wantsPipeline,
      suggestedAgents: agents,
      isDbAnchored: agents.includes('db'),
      needsAdmin: agents.includes('admin'),
      needsWeb: agents.includes('crawler'),
      explicitWantsReport: agents.includes('report'),
      explicitWantsVisualize: agents.includes('visualize'),
      planShortcut: 'none',
      dataSources,
      requiresAgentPipeline: wantsPipeline || dataSources.length >= 2,
      allowChatWebDirect: !wantsPipeline && dataSources.length <= 1,
      confidence: Math.max(Number(input.meta.dataPlaneConfidence ?? 0), 0.72),
      rationale: 'PU-Stack LLM 读题权威'
    }),
    lastUser: last,
    turnScopeMode: input.turnScope.mode,
    constraints: {
      timeHints: [],
      subjectHints: [],
      fieldHints: [],
      wantsVisualize: agents.includes('visualize'),
      wantsReport: agents.includes('report')
    }
  })
  return mergePuStackIntoOrchestratorBundle(empty, input.meta)
}
