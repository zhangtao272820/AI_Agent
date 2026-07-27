/**
 * 编排叙事：cap 与 DAG 格式化 smoke
 */
import { formatAgentCap, formatPlanExecutionDag, formatPlanOrchestrationSummary } from '../../../server/graph/orchestrate/orchestrationNarrative'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const cap = formatAgentCap(['rag', 'clean', 'code', 'admin', 'visualize'])
assert(cap.includes('、') && cap.includes('白名单 cap'), cap)
assert(!cap.includes('→'), 'cap must not use arrow')

const dag = formatPlanExecutionDag([
  { id: 's1', agent: 'rag', query: '取数' },
  { id: 's2', agent: 'admin', query: '日程' },
  { id: 's3', agent: 'clean', query: '清洗', dependsOn: ['s1'] },
  { id: 's4', agent: 'code', query: '计算', dependsOn: ['s3'] },
  { id: 's5', agent: 'visualize', query: '出图', dependsOn: ['s4'] }
])
assert(dag.includes('rag ∥ admin'), `parallel roots: ${dag}`)
assert(dag.includes('→'), dag)

const summary = formatPlanOrchestrationSummary({
  plan: [
    { id: 's1', agent: 'rag', query: 'q' },
    { id: 's2', agent: 'code', query: 'q', dependsOn: ['s1'] }
  ]
})
assert(summary.startsWith('编排 · 执行 DAG：'), summary)

console.log('smoke-orchestration-narrative: OK')
