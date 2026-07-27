import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), 'server/api/manager-ws/handlers')
for (const f of fs.readdirSync(dir)) {
  if (!f.startsWith('handle') || !f.endsWith('.ts')) continue
  const p = path.join(dir, f)
  let c = fs.readFileSync(p, 'utf8')
  c = c.replace(/import \{([^}]*)\} from '\.\/wsBarrel'/g, (m, inner) => {
    const parts = inner.split(',').map((s) => s.trim()).filter((s) => s && s !== 'send')
    if (!parts.length) return ''
    return `import { ${parts.join(', ')} } from './wsBarrel'`
  })
  c = c.replace(/\nimport \{\s*\} from '\.\/wsBarrel'\n/g, '\n')
  fs.writeFileSync(p, c, 'utf8')
}
console.log('fix-ws-barrel-imports: ok')
