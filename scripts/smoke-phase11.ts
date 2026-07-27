/**
 * Phase 11 smoke：RAG/Admin 经验联邦 + Skill draft 回填
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isAgentToolSuccess,
  shouldSyncRagExperience,
  shouldSyncAdminExperience
} from '../shared/agentOutcomePolicy'
import { isRagExperienceBridgeEnabled } from '../shared/ragExperienceBridge'
import { isAdminExperienceBridgeEnabled } from '../shared/adminExperienceBridge'
import { isSkillDraftBackfillEnabled } from '../shared/skillDraftBackfillJob'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-phase11] ${msg}`)
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

console.log('smoke-phase11: start')

assert(isRagExperienceBridgeEnabled(), 'rag bridge enabled by default')
assert(isAdminExperienceBridgeEnabled(), 'admin bridge enabled by default')
assert(isSkillDraftBackfillEnabled(), 'skill draft backfill enabled by default')

assert(
  isAgentToolSuccess({
    agentName: 'rag',
    resultText: '文档检索命中 3 条',
    successScore: 0.88,
    failureCategory: 'route_error',
    probeRagHits: 3
  }),
  'rag tool success with probeRagHits'
)

assert(
  shouldSyncRagExperience(
    {
      successScore: 0.88,
      failureCategory: 'route_error',
      planAgents: ['rag'],
      results: { rag: '检索结果' },
      probeRagHits: 3
    },
    { MGR_FEDERATION_REQUIRE_FEEDBACK: '0' } as NodeJS.ProcessEnv
  ),
  'rag experience sync eligible when gate off'
)

assert(
  shouldSyncAdminExperience(
    {
      successScore: 0.9,
      planAgents: ['admin'],
      results: { admin: '已成功发送飞书通知给相关同事' }
    },
    { MGR_FEDERATION_REQUIRE_FEEDBACK: '0' } as NodeJS.ProcessEnv
  ),
  'admin experience sync eligible when gate off'
)

const finalSrc = readSource('Manager_Agent/server/utils/managerGraph.finalNodes.ts')
assert(finalSrc.includes('syncRagExperienceFromManagerRun'), 'finalNodes syncs rag experience')
assert(finalSrc.includes('syncAdminExperienceFromManagerRun'), 'finalNodes syncs admin experience')

const opsSrc = readSource('Manager_Agent/server/api/manager/ops.post.ts')
assert(opsSrc.includes('skill_draft_backfill'), 'ops has skill_draft_backfill')

assert(fs.existsSync(path.join(repoRoot, 'shared/ragExperienceBridge.ts')), 'ragExperienceBridge exists')
assert(fs.existsSync(path.join(repoRoot, 'shared/adminExperienceBridge.ts')), 'adminExperienceBridge exists')
assert(fs.existsSync(path.join(repoRoot, 'Manager_Agent/server/utils/skillDraftBackfillJob.ts')), 'skillDraftBackfillJob exists')
assert(fs.existsSync(path.join(repoRoot, 'scripts/migrations/007_agent_memory_phase11.sql')), 'migration 007 exists')

const adminMemSrc = readSource('AI_admin_Agent/backend/app/core/memory_context.py')
assert(adminMemSrc.includes('format_admin_experience_block'), 'admin memory context uses tool experience')

console.log('smoke-phase11: OK')
