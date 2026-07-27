import fs from 'node:fs'
import path from 'node:path'

const root = path.join(process.cwd(), 'server/graph')

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p)
    else if (ent.name.endsWith('.ts')) {
      const t = fs.readFileSync(p, 'utf8')
      if (t.includes('\uFFFD')) console.log('FFFD', p)
      if (/\/continue\|[^/\n]*\?\.test/.test(t)) console.log('broken-regex', p)
    }
  }
}

walk(root)
