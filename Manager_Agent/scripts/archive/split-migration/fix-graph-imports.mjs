/**
 * Fix imports in server/graph/** that should point to server/utils (non-managerGraph modules).
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const graphRoot = path.join(root, 'server/graph')
const utilsRoot = path.join(root, 'server/utils')

function utilsExists(spec) {
  const base = spec.replace(/^\.\//, '')
  const candidates = [
    path.join(utilsRoot, `${base}.ts`),
    path.join(utilsRoot, base, 'index.ts'),
    path.join(utilsRoot, base)
  ]
  return candidates.some((p) => fs.existsSync(p))
}

function graphExists(fromFile, spec) {
  const base = spec.replace(/^\.\//, '')
  if (!base.startsWith('managerGraph')) return false
  const fromDir = path.dirname(fromFile)
  const direct = path.join(fromDir, `${base}.ts`)
  if (fs.existsSync(direct)) return true
  // search graph tree
  for (const dir of ['state', 'llm', 'nodes', 'orchestrate', 'core']) {
    const p = path.join(graphRoot, dir, `${base}.ts`)
    if (fs.existsSync(p)) return true
  }
  return false
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.name.endsWith('.ts')) out.push(p)
  }
  return out
}

const files = walk(graphRoot)
let fixes = 0

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8')
  const next = content.replace(/from\s+['"](\.\/[^'"]+)['"]/g, (full, spec) => {
    if (spec.startsWith('./managerGraph') && graphExists(file, spec)) return full
    if (utilsExists(spec)) {
      fixes++
      return `from '../../utils/${spec.replace(/^\.\//, '')}'`
    }
    return full
  })
  if (next !== content) fs.writeFileSync(file, next)
}

console.log(`fix-graph-imports: patched ${fixes} import paths`)
