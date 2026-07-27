/**
 * Fix import depths for llm/taskOrchestrator and core/proPuStack subdirs.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function fixDir(rel, depthToUtils) {
  const dir = path.join(root, rel)
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue
    const p = path.join(dir, f)
    let c = fs.readFileSync(p, 'utf8')
    c = c
      .replaceAll("from '../../utils/", `from '${depthToUtils}utils/`)
      .replaceAll("from '../../../../shared/", "from '../../../../../shared/")
      .replaceAll("from '../../../shared/", "from '../../../../shared/")
      .replaceAll("from '../core/", "from '../../core/")
      .replaceAll("from '../llm/", "from '../../llm/")
      .replaceAll("from '../orchestrate/", "from '../../orchestrate/")
      .replaceAll("from '../state/", "from '../../state/")
    fs.writeFileSync(p, c, 'utf8')
  }
  console.log('fix-mega-imports:', rel)
}

fixDir('server/graph/core/proPuStack', '../../../')
fixDir('server/graph/llm/taskOrchestrator', '../../../')
