/**
 * 批次 C 续：RAG/DB ready 探针结构回归（不依赖在线 Agent）
 */
import { probeServiceReady } from '../../../server/graph/core/runtime/serviceReady'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const bad = await probeServiceReady('http://127.0.0.1:1', 400)
assert(!bad.ready && !bad.healthOk, 'unreachable ready fails')
assert(bad.detail === 'unreachable' || Boolean(bad.detail), 'ready detail present')

console.log('smoke: batch-d ok')
