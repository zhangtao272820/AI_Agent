import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), 'server/api/manager-ws/handlers')
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.ts')) continue
  const p = path.join(dir, f)
  let c = fs.readFileSync(p, 'utf8')
  const n = c.replaceAll("import('../../utils/", "import('../../../utils/")
  if (n !== c) {
    fs.writeFileSync(p, n, 'utf8')
    console.log('fixed dynamic import', f)
  }
}
