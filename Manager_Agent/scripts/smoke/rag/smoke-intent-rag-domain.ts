/**
 * Intent RAG 域隔离 smoke（PB-3）
 */
import {
  intentRagExperienceDomainFactor,
  resolveManagerIntentRagDomain,
} from '../../../server/graph/core/rag/intentRagDomain'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(resolveManagerIntentRagDomain({ DB_AGENT_DOMAIN: 'p2026' } as NodeJS.ProcessEnv) === 'p2026', 'domain from DB_AGENT_DOMAIN')
assert(resolveManagerIntentRagDomain({} as NodeJS.ProcessEnv) === 'general', 'default general')

assert(intentRagExperienceDomainFactor('p2026', 'p2026') === 1, 'match')
assert(intentRagExperienceDomainFactor('p2026', 'other') === 0, 'mismatch')
assert(intentRagExperienceDomainFactor(undefined, 'p2026') === 0, 'untagged blocked in named domain')
assert(intentRagExperienceDomainFactor(undefined, 'general') === 1, 'untagged ok in general')

console.log('smoke: intent-rag-domain ok')
