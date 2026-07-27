/**
 * P0：用户反馈门控产物学习 — 契约类型与环境开关
 * 推荐 ARTIFACT_FEEDBACK_MODE=strict|off；单项 DB_/RAG_/ADM_ 仍可覆盖。
 */
import {
  isAdminToolExperienceFeedbackGated as isAdminToolFeedbackGatedByMode,
  isDbTemplateFeedbackGated as isDbTemplateFeedbackGatedByMode,
  isDbTemplateRevokeOnDislike as isDbTemplateRevokeOnDislikeByMode,
  isRagRetrievalFeedbackGated as isRagRetrievalFeedbackGatedByMode,
} from './artifactFeedbackMode'

export type ArtifactStatus = 'shadow' | 'confirmed' | 'revoked'

export type FeedbackArtifactKind = 'db_sql' | 'rag_retrieval' | 'admin_tool' | 'manager_plan'

export type FeedbackArtifact = {
  kind?: FeedbackArtifactKind
  sql_hash?: string
  source_labels?: string[]
  chunk_ids?: string[]
  tools?: string[]
  tool_chain?: string[]
}

export function isFederationFeedbackGated(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MGR_FEDERATION_REQUIRE_FEEDBACK ?? '1').trim() !== '0'
}

export function isDbTemplateFeedbackGated(env: NodeJS.ProcessEnv = process.env): boolean {
  return isDbTemplateFeedbackGatedByMode(env)
}

export function isDbTemplateRevokeOnDislike(env: NodeJS.ProcessEnv = process.env): boolean {
  return isDbTemplateRevokeOnDislikeByMode(env)
}

export function isAdminToolExperienceFeedbackGated(env: NodeJS.ProcessEnv = process.env): boolean {
  return isAdminToolFeedbackGatedByMode(env)
}

export function isRagRetrievalFeedbackGated(env: NodeJS.ProcessEnv = process.env): boolean {
  return isRagRetrievalFeedbackGatedByMode(env)
}

export function normalizeArtifact(input: unknown): FeedbackArtifact | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  const out: FeedbackArtifact = {}
  if (typeof o.kind === 'string') out.kind = o.kind as FeedbackArtifactKind
  if (typeof o.sql_hash === 'string') out.sql_hash = o.sql_hash.slice(0, 64)
  if (Array.isArray(o.source_labels)) out.source_labels = o.source_labels.map((x) => String(x).slice(0, 256)).slice(0, 12)
  if (Array.isArray(o.chunk_ids)) out.chunk_ids = o.chunk_ids.map((x) => String(x).slice(0, 120)).slice(0, 24)
  if (Array.isArray(o.tools)) out.tools = o.tools.map((x) => String(x).slice(0, 64)).slice(0, 12)
  if (Array.isArray(o.tool_chain)) out.tool_chain = o.tool_chain.map((x) => String(x).slice(0, 32)).slice(0, 12)
  return Object.keys(out).length ? out : null
}
