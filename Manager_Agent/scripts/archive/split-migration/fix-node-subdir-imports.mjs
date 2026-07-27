/**
 * Fix import paths for server/graph/nodes/{plan,exec}/ subdirs.
 */
import fs from 'node:fs'
import path from 'node:path'

function fixDir(rel) {
  const dir = path.join(process.cwd(), rel)
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue
    const p = path.join(dir, f)
    let c = fs.readFileSync(p, 'utf8')
    c = c
      .replaceAll("from '../core/", "from '../../core/")
      .replaceAll("from '../llm/", "from '../../llm/")
      .replaceAll("from '../orchestrate/", "from '../../orchestrate/")
      .replaceAll("from '../../utils/", "from '../../../utils/")
      .replaceAll("from '../../../shared/", "from '../../../../shared/")
      .replaceAll("from '../state/", "from '../../state/")
    fs.writeFileSync(p, c, 'utf8')
  }
  console.log('fix-node-subdir-imports:', rel)
}

fixDir('server/graph/nodes/plan')
fixDir('server/graph/nodes/exec')
fixDir('server/graph/nodes/router')
fixDir('server/graph/nodes/multi')
for (const d of ['planLinter', 'fix', 'orchestrate', 'search', 'intentClassify', 'prefetch', 'probe', 'toolHealth', 'decompose', 'scheduler', 'optimizer', 'evaluator', 'mode', 'monitor', 'voteAggregator', 'security', 'turnScope', 'resource', 'planPreview', 'meta']) {
  fixDir(`server/graph/nodes/${d}`)
}
