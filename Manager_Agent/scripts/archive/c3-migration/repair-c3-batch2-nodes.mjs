/** Repair ../../core/* prefix collisions in nodes/state after C3 batch-2 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const repairs = [
  ['../../core/planParallel', '../../core/managerGraph.planParallel'],
  ['../../core/planValidate', '../../core/managerGraph.planValidate'],
  ['../../core/planStepsEvent', '../../core/managerGraph.planStepsEvent'],
  ['../../core/planShortcuts', '../../core/managerGraph.planShortcuts'],
  ['../../core/plannerRules', '../../core/plannerRules'],
  ['../../core/planPreview', '../../core/managerGraph.planPreview'],
  ['../../core/planQuality', '../../core/managerGraph.planQuality'],
  ['../core/planParallel', '../core/managerGraph.planParallel'],
  ['../core/planValidate', '../core/managerGraph.planValidate'],
  ['../core/planStepsEvent', '../core/managerGraph.planStepsEvent'],
  ['../core/planShortcuts', '../core/managerGraph.planShortcuts'],
  ['../core/plannerRules', '../core/plannerRules'],
  ['../core/planPreview', '../core/managerGraph.planPreview'],
  ['../core/planQuality', '../core/managerGraph.planQuality']
]

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

let n = 0
for (const dir of ['server/graph/nodes', 'server/graph/state', 'server/graph/orchestrate', 'server/graph/llm']) {
  for (const file of walk(path.join(root, dir))) {
    const raw = fs.readFileSync(file, 'utf8')
    let c = raw.replace(/\r\n/g, '\n')
    let changed = false
    for (const [a, b] of repairs) {
      if (c.includes(a)) { c = c.split(a).join(b); changed = true }
    }
    if (changed) {
      n++
      fs.writeFileSync(file, raw.includes('\r\n') ? c.replace(/\n/g, '\r\n') : c, 'utf8')
      console.log('fixed:', path.relative(root, file))
    }
  }
}
console.log(`repaired ${n} files`)
