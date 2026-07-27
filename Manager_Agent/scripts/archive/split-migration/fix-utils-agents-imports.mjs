/**
 * Fix ./agents/* imports in utils subdirs → ../agents/*
 */
import fs from 'node:fs'
import path from 'node:path'

const utilsDir = path.join(process.cwd(), 'server/utils')
let patched = 0

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'agents') continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p)
    else if (ent.name.endsWith('.ts')) {
      let content = fs.readFileSync(p, 'utf8')
      const next = content.replace(/from (['"])\.\/agents\//g, 'from $1../agents/')
      if (next !== content) {
        fs.writeFileSync(p, next, 'utf8')
        patched++
      }
    }
  }
}

walk(utilsDir)
console.log(`fix-utils-agents-imports: patched ${patched} files`)
