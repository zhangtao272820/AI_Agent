/**
 * Fix llm/taskOrchestrator sibling imports: ./managerGraph.* → ../managerGraph.*
 */
import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), 'server/graph/llm/taskOrchestrator')
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.ts')) continue
  const p = path.join(dir, f)
  let c = fs.readFileSync(p, 'utf8')
  c = c.replace(/from '\.\/managerGraph\./g, "from '../managerGraph.")
  fs.writeFileSync(p, c, 'utf8')
}
console.log('fix-taskOrchestrator-imports: done')
