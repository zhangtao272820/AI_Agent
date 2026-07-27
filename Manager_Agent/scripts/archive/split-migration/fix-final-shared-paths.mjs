import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), 'server/graph/nodes/final')
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.ts')) continue
  const p = path.join(dir, f)
  let c = fs.readFileSync(p, 'utf8')
  const n = c.replaceAll("from '../../../shared/", "from '../../../../shared/")
  if (n !== c) fs.writeFileSync(p, n, 'utf8')
}
console.log('fix-final-shared-paths: ok')
