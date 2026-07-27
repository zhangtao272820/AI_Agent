/**
 * Call-Fusion smoke：总管侧车 → 域内跳过重复 NLU（源码审计 + 契约纯函数）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const root = dirname(fileURLToPath(import.meta.url))

/** 与 DB shouldSkipMonolithicPlanLlmForManager 同契约（避免 tsx 跨包 #agent-shared） */
function shouldSkipMonolithicPlanLlmForManager(mgr: {
  source?: string
  refined_question?: string
} | null | undefined): boolean {
  if (mgr?.source !== 'manager') return false
  return String(mgr.refined_question ?? '').trim().length >= 4
}

assert(
  shouldSkipMonolithicPlanLlmForManager({
    source: 'manager',
    refined_question: '河西区老人人数',
  }),
  'DB skip monolithic when refined_question',
)
assert(
  !shouldSkipMonolithicPlanLlmForManager({ source: 'manager', refined_question: '' }),
  'no skip without refined',
)

const dbCtx = readFileSync(join(root, '../../DB_Agent/utils/manager_task_context.ts'), 'utf8')
assert(dbCtx.includes('shouldSkipMonolithicPlanLlmForManager'), 'DB ctx exports skip monolithic')

const dbChain = readFileSync(join(root, '../../DB_Agent/utils/conversational_retrieval_chain.ts'), 'utf8')
assert(dbChain.includes('shouldSkipMonolithicPlanLlmForManager'), 'DB chain uses skip monolithic')

const ragNlu = readFileSync(join(root, '../../RAG_Agent/server/utils/rag_nlu.ts'), 'utf8')
assert(ragNlu.includes('orchestratedFused'), 'RAG understand uses fusion path')
assert(ragNlu.includes('buildOrchestratedRagQueryPlanFromManagerTask'), 'RAG fusion builder present')

const adminState = readFileSync(
  join(root, '../../AI_admin_Agent/backend/app/graph/state.py'),
  'utf8',
)
assert(!adminState.includes('infer_intent_from_action('), 'state.py must not call infer_intent_from_action')

const adminLlm = readFileSync(
  join(root, '../../AI_admin_Agent/backend/app/core/admin_manager_plan_llm.py'),
  'utf8',
)
assert(adminLlm.includes('def resolve_admin_intent_hint'), 'resolve_admin_intent_hint SSOT')

console.log('smoke-call-fusion: OK')
