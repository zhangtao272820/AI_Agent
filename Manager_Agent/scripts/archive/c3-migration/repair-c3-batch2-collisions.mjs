/** Repair prefix-collision damage from migrate-c3-batch2.mjs */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const repairs = [
  ["from './plannerRules'", "from './plannerRules'"],
  ["from './planParallel'", "from './managerGraph.planParallel'"],
  ["from '../planParallel'", "from '../managerGraph.planParallel'"],
  ["from '../planValidate'", "from '../managerGraph.planValidate'"],
  ["from './planBlueprintLlm'", "from './managerGraph.planBlueprintLlm'"],
  ["from '../planBlueprintLlm'", "from '../managerGraph.planBlueprintLlm'"],
  ["from './sharedTaskStack'", "from './managerGraph.sharedTaskStack'"]
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
for (const file of walk(path.join(root, 'server/graph'))) {
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

// restore deleted agentExecutors shim
const shim = path.join(root, 'server/graph/core/executors.ts')
if (!fs.existsSync(shim)) {
  fs.writeFileSync(shim, "/** B5: agent executors split — re-export shim */\r\nexport * from './executors'\r\n", 'utf8')
  console.log('restored:', path.relative(root, shim))
}

console.log(`repaired ${n} files`)
