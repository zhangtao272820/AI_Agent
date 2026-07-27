/**
 * DB Intent RAG 域隔离（PB-3）：experience 召回匹配蓝图域 DB_AGENT_DOMAIN。
 */
import { getDbAgentBlueprintEnv } from '../db_agent_env'

export function resolveDbIntentRagBlueprintDomain(env: NodeJS.ProcessEnv = process.env): string {
  return getDbAgentBlueprintEnv().domain
}

/** 无 blueprint_domain 的历史经验：仅在默认部署域 p2026 可召回（防换域 golden 泄漏） */
export function dbExperienceBlueprintEligible(
  entryBlueprint: unknown,
  activeBlueprint?: string,
): boolean {
  const active = String(activeBlueprint ?? resolveDbIntentRagBlueprintDomain()).trim() || 'p2026'
  const entry = String(entryBlueprint ?? '').trim()
  if (entry) return entry === active
  return active === 'p2026' || active === 'general'
}
