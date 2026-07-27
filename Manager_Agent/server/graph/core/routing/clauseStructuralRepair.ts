/**
 * 子句结构性修复：编排 LLM 漏标 agent / 单句透传时，按 dataSources 补齐绑定（不用正则拆用户句）。
 */

import type { TaskClause } from './clauses'
import type { DataSourceAgent } from '../../orchestrate/routeOrchestration'

const DATA_PLANE = new Set<string>(['rag', 'db', 'crawler'])

function clauseBoundPlanes(clauses: TaskClause[]): Set<DataSourceAgent> {
  const out = new Set<DataSourceAgent>()
  for (const c of clauses) {
    for (const a of c.agents ?? []) {
      if (DATA_PLANE.has(a)) out.add(a as DataSourceAgent)
    }
  }
  return out
}

/**
 * 当 dataSources 含多面但子句未绑定 agent 时，为每个数据面生成占位子句（queryFocus 仍由 blueprint LLM/Planner 细化）。
 */
export function repairOrchestratorClauses(
  clauses: TaskClause[],
  dataSources: DataSourceAgent[],
  userTask: string
): TaskClause[] {
  const ds = [...new Set(dataSources.filter((d) => DATA_PLANE.has(d)))]
  if (!ds.length) return clauses

  const bound = clauseBoundPlanes(clauses)
  const missing = ds.filter((d) => !bound.has(d))
  if (!missing.length) return clauses

  const task = String(userTask || '').trim()
  const baseText = clauses.length === 1 ? String(clauses[0]?.text || task).trim() : task

  if (clauses.length >= 2) {
    const repaired = clauses.map((c, i) => {
      if ((c.agents ?? []).length) return c
      const agent = ds[i] ?? ds[0]
      return agent ? { ...c, agents: [agent] as TaskClause['agents'] } : c
    })
    const stillMissing = ds.filter((d) => !clauseBoundPlanes(repaired).has(d))
    if (!stillMissing.length) return repaired
  }

  const out: TaskClause[] = [...clauses.filter((c) => (c.agents ?? []).length)]
  let seq = out.length
  for (const agent of missing) {
    seq += 1
    out.push({
      id: `c_repair_${agent}_${seq}`,
      text: baseText.slice(0, 480),
      layer: 'data',
      agents: [agent as TaskClause['agents'][number]]
    })
  }
  return out.length ? out : clauses
}
