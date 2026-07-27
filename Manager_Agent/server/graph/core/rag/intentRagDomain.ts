/**
 * Intent RAG 域隔离（PB-3）：experience 召回须匹配 DB_AGENT_DOMAIN，playbook 保持 L1 抽象。
 */

export function resolveManagerIntentRagDomain(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.DB_AGENT_DOMAIN ?? env.MANAGER_DOMAIN ?? env.AGENT_DOMAIN ?? 'general').trim()
  return raw || 'general'
}

/** 无 dataDomain 标签的历史经验：在具名域下不参与召回（防 golden 跨域泄漏） */
export function intentRagExperienceDomainFactor(
  entryDomain: unknown,
  activeDomain?: string,
): number {
  const active = String(activeDomain ?? resolveManagerIntentRagDomain()).trim() || 'general'
  const entry = String(entryDomain ?? '').trim()
  if (!entry) return active === 'general' ? 1 : 0
  return entry === active ? 1 : 0
}

export function isIntentRagExperienceDomainStrict(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_INTENT_RAG_DOMAIN_STRICT ?? '1').trim() !== '0'
}
