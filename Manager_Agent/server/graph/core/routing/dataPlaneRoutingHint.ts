/**
 * DataPlane LLM 产出 → 路由 hint（只读；不改 cap）
 */
import type { InferredDataSource } from '../proPuStack'

export type DataPlaneRoutingHint = {
  taskIntent: 'structured_query' | 'document_retrieval' | 'hybrid' | 'action' | 'unknown'
  primaryPlane: string
  hasExplicitSubject: boolean
  clarifyRisk: 'none' | 'low' | 'medium' | 'high'
  confidence: number
}

export function dataPlaneRoutingHintFromMeta(meta: unknown): DataPlaneRoutingHint | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  const taskIntent = String(m.dataPlaneTaskIntent || '').trim()
  if (!taskIntent || taskIntent === 'unknown') return null
  return {
    taskIntent: taskIntent as DataPlaneRoutingHint['taskIntent'],
    primaryPlane: String(m.dataPlanePrimaryPlane || 'none'),
    hasExplicitSubject: m.hasExplicitSubject === true,
    clarifyRisk: (String(m.dataPlaneClarifyRisk || 'low') as DataPlaneRoutingHint['clarifyRisk']) || 'low',
    confidence: Number(m.dataPlaneConfidence ?? 0)
  }
}

export function inferredDataSourcesFromMeta(meta: unknown, minConf = 0.45): InferredDataSource[] {
  if (!meta || typeof meta !== 'object') return []
  const raw = (meta as Record<string, unknown>).inferredDataSources
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x) => x && typeof x === 'object' && Number((x as { confidence?: number }).confidence ?? 0) >= minConf)
    .map((x) => x as InferredDataSource)
}
