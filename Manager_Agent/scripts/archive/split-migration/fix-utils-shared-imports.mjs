/**
 * Fix ../../shared/* imports after utils domain subdir move (need ../../../shared).
 */
import fs from 'node:fs'
import path from 'node:path'

const utilsDir = path.join(process.cwd(), 'server/utils')
let patched = 0

for (const ent of fs.readdirSync(utilsDir, { withFileTypes: true })) {
  if (!ent.isDirectory() || ent.name === 'agents') continue
  const dir = path.join(utilsDir, ent.name)
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue
    const p = path.join(dir, file)
    let content = fs.readFileSync(p, 'utf8')
    const next = content.replace(/from (['"])\.\.\/\.\.\/shared\//g, 'from $1../../../shared/')
    if (next !== content) {
      fs.writeFileSync(p, next, 'utf8')
      patched++
    }
  }
}

console.log(`fix-utils-shared-imports: patched ${patched} files`)
