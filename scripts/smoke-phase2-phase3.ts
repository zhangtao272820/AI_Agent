/**
 * Phase 2/3 smoke：共享记忆 API + 进化 verify 探针
 */
import { getAmpSummary } from '../shared/agentMemoryPolicy'
import { shouldWriteExperience } from '../shared/agentMemoryApi'
import { rankRecallCandidates } from '../shared/agentMemoryRecall'
import { verifyBeforePromote } from '../shared/evolutionVerify'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

async function main() {
  assert(shouldWriteExperience(0.8), 'experience threshold accepts 0.8')
  assert(!shouldWriteExperience(0.5), 'experience threshold rejects 0.5')

  const ranked = rankRecallCandidates('张三用药', [
    { text: '查张三上个月用药记录', ts: new Date().toISOString(), successScore: 0.95 },
    { text: '天气怎么样', ts: new Date(Date.now() - 30 * 86_400_000).toISOString(), successScore: 0.72 }
  ], { limit: 1 })
  assert(ranked[0]?.text.includes('用药'), 'recall ranks relevant experience')

  const amp = getAmpSummary()
  assert(amp.version.includes('phase2'), 'AMP policy version bumped')

  for (const agent of ['db', 'manager', 'rag', 'admin'] as const) {
    const v = await verifyBeforePromote(agent)
    assert(v.ok, `${agent} verify gate failed: ${v.reason}`)
    console.log(`verify:${agent} ok (${v.gate})`)
  }

  console.log('smoke: phase2-phase3 ok')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
