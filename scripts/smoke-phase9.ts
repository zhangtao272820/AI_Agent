/**
 * Phase 9 smoke：成功信号对齐、DB 经验桥、Prometheus 记忆指标
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isAgentToolSuccess,
  isSkillDraftEligible,
  shouldSyncDbExperience
} from '../shared/agentOutcomePolicy'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[smoke-phase9] ${msg}`)
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

console.log('smoke-phase9: start')

// 李雨桐 DB 问句场景：route_error 但 probeDbMatched + 有结果 → 应记 db 成功
const liCase = isAgentToolSuccess({
  agentName: 'db',
  resultText: '李雨桐 项目记录 1 条',
  successScore: 0.85,
  failureCategory: 'route_error',
  probeDbMatched: true
})
assert(liCase, 'db tool success with route_error + probeDbMatched')

assert(
  isSkillDraftEligible({
    successScore: 0.85,
    failureCategory: 'route_error',
    planAgents: ['db'],
    results: { db: '李雨桐记录' },
    probeDbMatched: true
  }),
  'skill draft eligible when db agent succeeded'
)

assert(
  shouldSyncDbExperience(
    {
      successScore: 0.85,
      failureCategory: 'route_error',
      planAgents: ['db'],
      results: { db: '李雨桐记录' },
      probeDbMatched: true
    },
    { MGR_FEDERATION_REQUIRE_FEEDBACK: '0' } as NodeJS.ProcessEnv
  ),
  'db experience sync eligible when federation gate off'
)

assert(
  !shouldSyncDbExperience({
    successScore: 0.85,
    failureCategory: 'route_error',
    planAgents: ['db'],
    results: { db: '李雨桐记录' },
    probeDbMatched: true
  }),
  'db experience sync deferred when P0 federation gate on'
)

assert(
  shouldSyncDbExperience(
    {
      successScore: 0.85,
      failureCategory: 'route_error',
      planAgents: ['db'],
      results: { db: '李雨桐记录' },
      probeDbMatched: true
    },
    { MGR_FEDERATION_REQUIRE_FEEDBACK: '1' } as NodeJS.ProcessEnv,
    { force: true }
  ),
  'db experience sync force on confirm'
)

const finalSrc = readSource('Manager_Agent/server/utils/managerGraph.finalNodes.ts')
assert(finalSrc.includes('syncDbExperienceFromManagerRun'), 'finalNodes syncs db experience')
assert(finalSrc.includes('isAgentToolSuccess'), 'finalNodes uses agent outcome policy')

const promSrc = readSource('Manager_Agent/server/api/metrics/prometheus.get.ts')
assert(promSrc.includes('queryMemoryPgStats'), 'prometheus exports memory pg stats')

assert(fs.existsSync(path.join(repoRoot, 'shared/agentOutcomePolicy.ts')), 'agentOutcomePolicy exists')
assert(fs.existsSync(path.join(repoRoot, 'shared/dbExperienceBridge.ts')), 'dbExperienceBridge exists')

console.log('smoke-phase9: OK')
