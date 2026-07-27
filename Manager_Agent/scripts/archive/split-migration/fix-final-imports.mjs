import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), 'server/graph/nodes/final')
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.ts')) continue
  const p = path.join(dir, f)
  let c = fs.readFileSync(p, 'utf8')
  c = c
    .replaceAll("from '../core/", "from '../../core/")
    .replaceAll("from '../../utils/", "from '../../../utils/")
    .replaceAll("from '../../../shared/", "from '../../../../shared/")
  fs.writeFileSync(p, c, 'utf8')
}
console.log('fix-final-imports: ok')
