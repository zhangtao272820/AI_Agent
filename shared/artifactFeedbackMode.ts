/**
 * 产物学习反馈门控 MODE：ARTIFACT_FEEDBACK_MODE 替代 DB/RAG/Admin 分散的 *_REQUIRE_FEEDBACK=0/1。
 */

export type ArtifactFeedbackMode = 'strict' | 'off'

function parseFeedbackMode(raw: string): ArtifactFeedbackMode | null {
  const v = String(raw ?? '').trim().toLowerCase()
  if (!v) return null
  if (v === 'off' || v === '0' || v === 'false' || v === 'no' || v === 'relaxed') return 'off'
  if (v === 'strict' || v === 'on' || v === '1' || v === 'default' || v === 'production') return 'strict'
  return null
}

export function resolveArtifactFeedbackMode(env: NodeJS.ProcessEnv = process.env): ArtifactFeedbackMode {
  const explicit = parseFeedbackMode(String(env.ARTIFACT_FEEDBACK_MODE ?? ''))
  if (explicit) return explicit
  return 'strict'
}

export function isDbTemplateFeedbackGated(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DB_TEMPLATE_REQUIRE_FEEDBACK
  if (raw !== undefined && String(raw).trim() !== '') {
    return String(raw).trim() !== '0'
  }
  return resolveArtifactFeedbackMode(env) === 'strict'
}

export function isDbTemplateRevokeOnDislike(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DB_TEMPLATE_REVOKE_ON_DISLIKE
  if (raw !== undefined && String(raw).trim() !== '') {
    return String(raw).trim() !== '0'
  }
  return resolveArtifactFeedbackMode(env) === 'strict'
}

export function isRagRetrievalFeedbackGated(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.RAG_RETRIEVAL_REQUIRE_FEEDBACK
  if (raw !== undefined && String(raw).trim() !== '') {
    return String(raw).trim() !== '0'
  }
  return resolveArtifactFeedbackMode(env) === 'strict'
}

export function isAdminToolExperienceFeedbackGated(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ADM_TOOL_EXPERIENCE_REQUIRE_FEEDBACK
  if (raw !== undefined && String(raw).trim() !== '') {
    return String(raw).trim() !== '0'
  }
  return resolveArtifactFeedbackMode(env) === 'strict'
}
