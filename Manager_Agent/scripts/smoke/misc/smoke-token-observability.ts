/**
 * CF-5 smoke：tokenSummary.byModelTier 聚合与能力层粗分
 */
import {
  aggregateTokensByTier,
  resolveCapabilityTierFromModel,
} from '../../../server/graph/core/agent/capabilityTier'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(resolveCapabilityTierFromModel('qwen3.5-flash-2026-02-23') === 'T0', 'flash → T0')
assert(resolveCapabilityTierFromModel('qwen-plus-2025-12-01') === 'T1', 'plus → T1')
assert(resolveCapabilityTierFromModel('qwen3-coder-flash') === 'T2', 'coder → T2')

const tier = aggregateTokensByTier([
  { model: 'qwen3.5-flash-2026-02-23', tokens: 100 },
  { model: 'qwen-plus-2025-12-01', tokens: 400 },
  { model: 'qwen3-coder-flash', tokens: 80 },
])
assert(tier.T0 === 100, `T0: ${tier.T0}`)
assert(tier.T1 === 400, `T1: ${tier.T1}`)
assert(tier.T2 === 80, `T2: ${tier.T2}`)

console.log('smoke-token-observability: OK')
