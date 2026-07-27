import { isPgVectorEnabled, PGVECTOR_DIM } from '../shared/agentVectorPg'
import { isSessionArchiveEnabled } from '../shared/sessionArchiveJob'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

assert(isPgVectorEnabled(), 'pgvector backend default enabled')
assert(PGVECTOR_DIM === 1536, 'pgvector dim 1536')
assert(isSessionArchiveEnabled(), 'session archive job enabled')
console.log('smoke: phase4-phase5 ok')
