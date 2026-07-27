/**
 * 过度 clarify 抑制（DataPlane + probe 一致时 proceed）
 */
import type { DataPlaneRoutingHint } from '../routing/dataPlaneRoutingHint'

export function shouldSuppressClarifyFromHint(hint: DataPlaneRoutingHint | null | undefined): boolean {
  if (!hint) return false
  if (hint.clarifyRisk === 'high') return false
  if (hint.confidence < 0.55) return false
  if (hint.taskIntent === 'structured_query' && hint.primaryPlane === 'db') return true
  if (hint.taskIntent === 'document_retrieval' && hint.primaryPlane === 'rag') return true
  if (hint.taskIntent === 'hybrid' && hint.confidence >= 0.65) return true
  if (hint.hasExplicitSubject && (hint.clarifyRisk === 'none' || hint.clarifyRisk === 'low')) return true
  return false
}

/** planLinter 澄清门控：编排已判定不需澄清 / 输出追问 / 澄清补答后禁止二次 clarify */
export function shouldSuppressPlanLinterClarify(meta: unknown): boolean {
  const m = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>
  if (m.clarifySuppressSecondLoop === true) return true
  if (m.clarifyReplan === true) return true
  if (String(m.turnKind || '').trim() === 'output_followup') return true
  const ck = String(m.clarifyKind || '').trim()
  if (ck === 'output_disambiguation') return true
  if (m.needsClarify === false && (ck === 'none' || ck === 'output_disambiguation')) return true
  return false
}
