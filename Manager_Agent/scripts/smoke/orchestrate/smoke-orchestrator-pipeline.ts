/**
 * 编排流水线 smoke（离线：结构性 lint + 不变量；不调用 LLM）
 */
import {
  verifyOrchestratorPipelineStructure
} from '../../../server/utils/route/managerRouteMatrixVerify'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const checks = verifyOrchestratorPipelineStructure()
for (const c of checks) {
  assert(c.ok, `${c.id}: ${c.detail ?? 'failed'}`)
}

console.log('smoke-orchestrator-pipeline: OK')
