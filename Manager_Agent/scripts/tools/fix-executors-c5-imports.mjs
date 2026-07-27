/** UTF-8 safe: fix executors/ imports after C5 + C5b */
import fs from 'node:fs'
import path from 'node:path'

const execDir = path.join(process.cwd(), 'server/graph/core/executors')
const MAP = [
  ["from '../managerGraph.dbPrefetch'", "from '../db/dbPrefetch'"],
  ["from '../managerGraph.dbStepQuestion'", "from '../db/dbStepQuestion'"],
  ["from '../managerGraph.writeGate'", "from '../db/writeGate'"],
  ["from '../managerGraph.downstreamMetrics'", "from '../output/downstreamMetrics'"],
  ["from '../managerGraph.retrieverPlan'", "from '../probe/retrieverPlan'"],
  ["from '../managerGraph.ragPrefetch'", "from '../rag/ragPrefetch'"],
  ["from '../managerGraph.ragRetrievePolicy'", "from '../rag/ragRetrievePolicy'"],
  ["from '../managerGraph.agentAnswerJudge'", "from '../agent/agentAnswerJudge'"],
  ["from '../managerGraph.sessionBridge'", "from '../runtime/sessionBridge'"],
  ["from '../managerGraphGuiTaskPayload'", "from '../agent/guiTaskPayload'"],
  ["from '../../llm/managerGraph.taskConstraintsLlm'", "from '../../llm/taskConstraintsLlm'"],
  ["from '../../state/managerGraph.state'", "from '../../state/state'"]
]

let n = 0
for (const f of fs.readdirSync(execDir)) {
  if (!f.endsWith('.ts')) continue
  const p = path.join(execDir, f)
  let raw = fs.readFileSync(p, 'utf8')
  let next = raw
  for (const [a, b] of MAP) next = next.split(a).join(b)
  if (next !== raw) {
    fs.writeFileSync(p, next, 'utf8')
    n++
    console.log('fixed:', f)
  }
}
console.log(`Done executors fix: ${n} files`)
