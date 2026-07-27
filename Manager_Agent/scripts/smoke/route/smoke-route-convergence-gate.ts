/**
 * 路由收敛期离线门禁（L1 拓扑 + 编排结构）。
 * 发版前另须：npx tsx scripts/smoke-route-matrix-orchestrate.ts（真实 LLM 8/8）
 */
import { ROUTE_MATRIX_CASES } from './route-matrix-cases'
import {
  verifyRouteMatrixTopologyCases,
  verifyOrchestratorPipelineStructure
} from '../../../server/utils/route/managerRouteMatrixVerify'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const topology = verifyRouteMatrixTopologyCases(ROUTE_MATRIX_CASES)
for (const t of topology) {
  assert(t.ok, `${t.id}: ${t.detail ?? 'topology failed'}`)
}

const pipeline = verifyOrchestratorPipelineStructure()
for (const p of pipeline) {
  assert(p.ok, `${p.id}: ${p.detail ?? 'pipeline failed'}`)
}

console.log(
  `smoke-route-convergence-gate: OK (${topology.length} matrix + ${pipeline.length} pipeline checks)`
)
console.log('下一步（需 OPENAI_API_KEY）：npx tsx scripts/smoke-route-matrix-orchestrate.ts')
