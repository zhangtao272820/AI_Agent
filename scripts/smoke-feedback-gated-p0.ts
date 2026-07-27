/**
 * P0 smoke：反馈门控产物学习（policy + 状态机 + 联邦 defer）
 * 用法：cd Manager_Agent && npx tsx ../scripts/smoke-feedback-gated-p0.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isDbTemplateFeedbackGated,
  isFederationFeedbackGated,
  normalizeArtifact
} from '../shared/artifactFeedbackPolicy'
import { hashSql } from '../shared/artifactStore'
import { shouldSyncDbExperience } from '../shared/agentOutcomePolicy'
import { captureRunArtifactsFromState } from '../shared/artifactRunCapture'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-feedback-gated-p0] ${msg}`)
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

console.log('smoke-feedback-gated-p0: start')

process.env.MGR_FEDERATION_REQUIRE_FEEDBACK = '1'
process.env.DB_TEMPLATE_REQUIRE_FEEDBACK = '1'

assert(isFederationFeedbackGated(), 'federation gated by default')
assert(isDbTemplateFeedbackGated(), 'db template gated by default')

assert(
  !shouldSyncDbExperience({
    successScore: 0.9,
    planAgents: ['db'],
    results: { db: 'ok' },
    probeDbMatched: true
  }),
  'federation sync deferred when gated'
)

const art = normalizeArtifact({
  kind: 'db_sql',
  sql_hash: hashSql('SELECT 1'),
  tool_chain: ['db']
})
assert(art?.kind === 'db_sql', 'artifact normalize kind')
assert(art?.sql_hash?.length === 64, 'artifact sql_hash')

const captured = captureRunArtifactsFromState(
  {
    intent: 'multi',
    probe: { rag: { sources: ['doc_a', 'doc_b'] } },
    evidence: [{ kind: 'db', executed_sql: 'SELECT id FROM users LIMIT 10' }]
  },
  ['db', 'rag'],
  '查询用户数量'
)
assert(captured.toolChain.includes('db'), 'capture tool chain db')
assert(captured.subArtifacts.rag?.source_labels?.includes('doc_a'), 'capture rag sources')
assert(captured.subArtifacts.db?.sql_hash, 'capture db sql hash')

const finalSrc = readSource('Manager_Agent/server/utils/managerGraph.finalNodes.ts')
assert(finalSrc.includes('saveShadowRunArtifacts'), 'finalNodes saves shadow artifacts')
assert(finalSrc.includes('run_artifacts'), 'finalNodes emits run_artifacts')

const wsSrc = readSource('Manager_Agent/server/api/manager-ws.ts')
assert(wsSrc.includes('confirmRunArtifacts'), 'manager ws confirms artifacts')
assert(wsSrc.includes('revokeRunArtifacts'), 'manager ws revokes artifacts')

const dbFb = readSource('DB_Agent/server/api/feedback.post.ts')
assert(dbFb.includes('handleDbAgentFeedback'), 'db feedback gates templates')

const ragFb = readSource('RAG_Agent/server/api/feedback.post.ts')
assert(ragFb.includes('handleRagAgentFeedback'), 'rag feedback gates retrieval')

const adminMain = readSource('AI_admin_Agent/backend/app/main.py')
assert(adminMain.includes('handle_admin_feedback'), 'admin feedback gates tool experience')

const migration = readSource('scripts/migrations/009_agent_memory_phase12_p0.sql')
assert(migration.includes('db_query_templates'), 'migration db_query_templates')
assert(migration.includes('mgr_run_artifacts'), 'migration mgr_run_artifacts')
assert(migration.includes('rag_retrieval_artifacts'), 'migration rag_retrieval_artifacts')

console.log('smoke-feedback-gated-p0: OK')
