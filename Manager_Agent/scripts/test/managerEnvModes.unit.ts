/**
 * Q1: unit-style assertions for MODE SSOT (extracted from smoke-env-modes).
 */
import {
  resolveManagerRouteMode,
  resolveManagerProMode,
  resolveManagerEvolutionMode,
  resolveManagerPlatformMode,
  resolveManagerAuthMode,
  resolveManagerRuntimeMode,
  resolveManagerEnvBool,
  isManagerDockerRuntime
} from '../../server/utils/platform/managerEnvModes'
import { isOrchestratorLlmOnlyMode } from '../../server/graph/orchestrate/orchestratorPipeline'
import { isLlmFirstRouteEnabled } from '../../server/graph/orchestrate/unifiedRouting'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`assert failed: ${msg}`)
}

const env = {
  MANAGER_ROUTE_MODE: 'convergence',
  MANAGER_PRO_MODE: 'strong',
  MANAGER_EVOLUTION_MODE: 'convergence',
  MANAGER_PLATFORM_MODE: 'local',
  MANAGER_AUTH_MODE: 'token',
  MANAGER_RUNTIME: 'docker'
} as NodeJS.ProcessEnv

assert(resolveManagerRouteMode(env) === 'convergence', 'route mode')
assert(resolveManagerProMode(env) === 'strong', 'pro mode')
assert(isOrchestratorLlmOnlyMode(env), 'llm only from route mode')
assert(isLlmFirstRouteEnabled(env), 'llm-first from convergence preset')
assert(resolveManagerEnvBool('MANAGER_UNIFIED_ORCHESTRATOR', env) === true, 'unified orchestrator preset')
assert(isManagerDockerRuntime(env), 'docker runtime')

console.log('managerEnvModes.unit: OK')
