/**
 * 自进化收敛期 smoke：MODE 预设 + promote 门禁 + 路由学习写入门禁
 * 用法：cd Manager_Agent && npx tsx ../scripts/smoke-evolution-convergence.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveManagerEnvBool } from '../Manager_Agent/server/utils/managerEnvModes'
import {
  isAgentEvolutionStageAllowed,
  isPromoteVerifyRequired,
  shouldRecordManagerRouteLearning,
} from '../shared/evolutionPromotePolicy.ts'
import { isAgentPromptEvolutionExecutionOnly } from '../shared/evolutionConvergence.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const convergence = {
  EVO_MODE: 'convergence',
  MANAGER_ROUTE_MODE: 'convergence',
  MANAGER_EVOLUTION_MODE: 'convergence',
} as NodeJS.ProcessEnv

assert(!resolveManagerEnvBool('MANAGER_ROUTE_BANDIT', convergence), 'bandit off')
assert(!resolveManagerEnvBool('MANAGER_ROUTE_STRATEGY', convergence), 'strategy off')
assert(!resolveManagerEnvBool('MANAGER_ROUTE_POLICY_RL', convergence), 'policy rl off')
assert(!resolveManagerEnvBool('MANAGER_ROUTE_CAUSAL', convergence), 'causal off')
assert(!resolveManagerEnvBool('MANAGER_EXPERIENCE_REPLAY', convergence), 'experience replay off')
assert(!resolveManagerEnvBool('MANAGER_ROUTER_NEGATIVE_HINTS', convergence), 'negative hints off')
assert(!resolveManagerEnvBool('MANAGER_PROMPT_EVOLVE', convergence), 'manager prompt evolve off')
assert(!resolveManagerEnvBool('MANAGER_IMPLICIT_LEARNING', convergence), 'implicit learning off')
assert(isPromoteVerifyRequired(convergence), 'verify required')
assert(isAgentPromptEvolutionExecutionOnly(convergence), 'execution only default')

assert(isAgentEvolutionStageAllowed('admin', 'planning', convergence), 'admin planning ok')
assert(!isAgentEvolutionStageAllowed('admin', 'routing', convergence), 'admin routing blocked')
assert(isAgentEvolutionStageAllowed('db', 'sql', convergence), 'db sql ok')
assert(isAgentEvolutionStageAllowed('rag', 'retrieval', convergence), 'rag retrieval ok')

assert(shouldRecordManagerRouteLearning({ routeMatrixPass: true, orchestratorJudgeAccept: true }, convergence), 'learning pass')
assert(!shouldRecordManagerRouteLearning({ routeMatrixPass: false, orchestratorJudgeAccept: true }, convergence), 'matrix fail blocks')

const learning = { ...convergence, EVO_MODE: 'learning', MANAGER_EVOLUTION_MODE: 'learning' } as NodeJS.ProcessEnv
assert(resolveManagerEnvBool('MANAGER_ROUTE_BANDIT', learning), 'bandit on in learning mode')
assert(resolveManagerEnvBool('MANAGER_ROUTE_POLICY_RL', learning), 'policy rl on in learning mode')

const ssotExample = path.join(repoRoot, 'Manage-platform_Agent', '.env.convergence-modes.example')
assert(fs.existsSync(ssotExample), 'convergence modes SSOT example exists')
const ssotText = fs.readFileSync(ssotExample, 'utf8')
assert(/MANAGER_ROUTE_MODE=convergence/.test(ssotText), 'SSOT route mode')
assert(/EVO_MODE=convergence/.test(ssotText), 'SSOT EVO_MODE')

console.log('smoke-evolution-convergence: OK')
