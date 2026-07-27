/**
 * 编排 cap 冻结/下限策略（PU-Stack 权威路径）
 */
import type { IntentClassifyResult } from '../llm/intentClassifyLlm'
import type { TaskClause } from '../core/routing/clauses'
import type { ExecutableAgent } from '../core/routing/routeFinalize'
import { sortAgentsByPipelineOrder } from '../core/routing/clauses'
import { capFloorFromPuStackMeta } from './puStackOrchestratorAuthority'
import { hasPuStackCompositeHint } from '../core/routing/proRoutePolicy'
import type { ProbeDbSlice } from '../core/probe/probeInterpretation'

export type OrchestratorCapPolicy = { mode: 'default' | 'frozen' }

export function applyCapFloor(allowed: ExecutableAgent[], floor: ExecutableAgent[]): ExecutableAgent[] {
  if (!floor.length) return allowed
  return sortAgentsByPipelineOrder([...new Set([...allowed, ...floor])]) as ExecutableAgent[]
}

export function capFloorFromOrchestratorEvidence(input: {
  clauses?: TaskClause[]
  intentClassify?: IntentClassifyResult
  bundleAllowed?: ExecutableAgent[]
  meta?: unknown
  probe?: { db?: ProbeDbSlice; rag?: { hits?: number } } | null
}): ExecutableAgent[] {
  if (hasPuStackCompositeHint(input.meta)) {
    return capFloorFromPuStackMeta(input.meta, input.probe)
  }
  const out = new Set<string>()
  for (const a of input.bundleAllowed ?? []) out.add(String(a))
  for (const c of input.clauses ?? []) {
    for (const a of c.agents ?? []) out.add(String(a))
  }
  if (input.intentClassify?.needsAdmin) out.add('admin')
  if (input.intentClassify?.explicitWantsVisualize) {
    out.add('visualize')
    out.add('code')
  }
  return sortAgentsByPipelineOrder([...out] as ExecutableAgent[]) as ExecutableAgent[]
}

export function freezeCapAuthorityMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return { ...meta, orchestratorCapPolicy: 'frozen' }
}

export function isCompositeOrchestration(meta: unknown): boolean {
  return hasPuStackCompositeHint(meta)
}

export function syncDbAnchorFromOrchestratorEvidence(
  classify: IntentClassifyResult,
  clauses: TaskClause[],
  allowed: ExecutableAgent[]
): IntentClassifyResult {
  if (allowed.includes('db')) {
    return { ...classify, isDbAnchored: true, dataSources: [...new Set([...(classify.dataSources ?? []), 'db'])] as IntentClassifyResult['dataSources'] }
  }
  return classify
}

export function guardReconcileAgainstCapFloor(
  allowed: ExecutableAgent[],
  floor: ExecutableAgent[]
): ExecutableAgent[] {
  if (!floor.length) return allowed
  const floorSet = new Set(floor.map(String))
  return sortAgentsByPipelineOrder([...new Set([...allowed.filter((a) => floorSet.has(String(a))), ...floor])]) as ExecutableAgent[]
}
