/**
 * Fix handler import paths (depth) without corrupting UTF-8.
 */
import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), 'server/api/manager-ws/handlers')

for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.ts')) continue
  const p = path.join(dir, file)
  let c = fs.readFileSync(p, 'utf8')
  c = c
    .replaceAll("from '../../utils/", "from '../../../utils/")
    .replaceAll('from "../../utils/', 'from "../../../utils/')
    .replaceAll("import('../../utils/", "import('../../../utils/")
  fs.writeFileSync(p, c, 'utf8')
}

console.log('fix-ws-handler-paths: done')
