/**
 * Fix server/graph imports that should point to server/utils (static + dynamic + type imports).
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

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.name.endsWith('.ts')) out.push(p)
  }
  return out
}

function rewriteUtilsImports(content) {
  return content.replace(/(['"])(\.\/[^'"]+)\1/g, (full, quote, spec) => {
    if (spec.startsWith('./managerGraph')) return full
    if (!utilsExists(spec)) return full
    const base = spec.replace(/^\.\//, '')
    return `${quote}../../utils/${base}${quote}`
  })
}

let patched = 0
for (const file of walk(graphRoot)) {
  const raw = fs.readFileSync(file, 'utf8')
  const next = rewriteUtilsImports(raw)
  if (next !== raw) {
    fs.writeFileSync(file, next, 'utf8')
    patched++
  }
}

console.log(`fix-graph-utils-imports: patched ${patched} files`)
