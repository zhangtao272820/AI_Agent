/**
 * M5 Cost-Flash 验收 smoke：convergence 预设 + T0 flash 分层 + Intent RAG token 预算。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clipIntentRagHint,
  INTENT_RAG_HINT_MAX_CHARS,
  INTENT_RAG_PROMPT_TOP_K,
  intentRagPromptTopK,
} from '../shared/costFlashPolicy.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

async function main() {
  const { resolveManagerEnvBool } = await import('../Manager_Agent/server/utils/managerEnvModes.ts')
  const { resolveCapabilityTierFromModel } = await import(
    '../Manager_Agent/server/utils/managerGraph.capabilityTier.ts'
  )
  const { shouldUseIntentRagFastPath } = await import(
    '../Manager_Agent/server/utils/managerGraph.intentRagRecallCore.ts'
  )

  const convergence = {
    MANAGER_ROUTE_MODE: 'convergence',
    MANAGER_PRO_MODE: 'strong',
  } as NodeJS.ProcessEnv

  assert(resolveManagerEnvBool('MANAGER_AUTO_MODEL_TIER', convergence), 'CF-4 auto tier')
  assert(resolveManagerEnvBool('MANAGER_INTENT_MERGED_LLM', convergence), 'CF-2 merged understand')
  assert(!resolveManagerEnvBool('MANAGER_INTENT_RAG_FAST_PATH', convergence), 'playbook fast path off')

  assert(resolveCapabilityTierFromModel('qwen3.5-flash-2026-02-23') === 'T0', 'flash → T0')
  assert(resolveCapabilityTierFromModel('qwen-plus-2025-12-01') === 'T1', 'plus → T1')

  assert(intentRagPromptTopK({}) === INTENT_RAG_PROMPT_TOP_K, 'default intent rag top k')
  assert(intentRagPromptTopK({ MANAGER_INTENT_RAG_TOP_K: '2' }) === 2, 'env top k')

  const long = 'x'.repeat(200)
  assert(clipIntentRagHint(long).length <= INTENT_RAG_HINT_MAX_CHARS, 'hint clipped')

  const playbookHit = {
    id: 'p1',
    score: 0.9,
    source: 'playbook' as const,
    matchedText: 'test',
    primaryIntent: 'rag' as const,
    isMulti: false,
    suggestedAgents: ['rag'] as const,
    isDbAnchored: false,
    needsAdmin: false,
    needsWeb: false,
    explicitWantsReport: false,
    explicitWantsVisualize: false,
    planShortcut: 'rag_only' as const,
    explanation: 'playbook',
  }
  assert(!shouldUseIntentRagFastPath(playbookHit, '查知识库'), 'playbook never fast path')

  const example = readFileSync(
    join(root, 'Manage-platform_Agent/.env.convergence-modes.example'),
    'utf8',
  )
  assert(example.includes('MANAGER_ROUTE_MODE=convergence'), 'convergence SSOT')
  assert(example.includes('DB_AGENT_DOMAIN='), 'domain SSOT')
  assert(example.includes('MANAGER_INTENT_RAG_TOP_K=2'), 'intent rag top k in SSOT')

  const recallSrc = readFileSync(
    join(root, 'Manager_Agent/server/utils/managerGraph.intentRagRecall.ts'),
    'utf8',
  )
  assert(recallSrc.includes('clipIntentRagHint'), 'intent recall uses hint clip')
  assert(recallSrc.includes('intentRagPromptTopK'), 'intent recall uses top k policy')

  console.log('smoke-cost-flash-gate: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
