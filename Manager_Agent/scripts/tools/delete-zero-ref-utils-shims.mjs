/**
 * C4: delete server/utils/managerGraph*.ts shims with no utils-path imports.
 * Only counts imports via utils/managerGraph* or server/utils/managerGraph* (not graph-internal ../managerGraph.*).
 * Usage: node scripts/delete-zero-ref-utils-shims.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const root = process.cwd()
const utilsDir = path.join(root, 'server/utils')

function walk(dir, out = [], skipArchive = true) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (skipArchive && e.name === 'archive') continue
      if (e.name === 'node_modules') continue
      walk(p, out, skipArchive)
    } else if (/\.(ts|vue|mjs|js|json)$/.test(e.name)) out.push(p)
  }
  return out
}

function isToolScript(file) {
  const rel = path.relative(root, file).replace(/\\/g, '/')
  if (rel.startsWith('scripts/archive/')) return true
  if (/^scripts\/(migrate-|delete-zero-ref|repair-c3|restore-|trim-exec)/.test(rel)) return true
  return false
}

function allSourceFiles() {
  const files = []
  for (const d of ['server', 'scripts', 'shared', '.']) {
    const base = d === '.' ? root : path.join(root, d)
    if (d === '.') {
      for (const f of ['nuxt.config.ts']) {
        const p = path.join(root, f)
        if (fs.existsSync(p)) files.push(p)
      }
      continue
    }
    walk(base, files)
  }
  return files.filter((f) => !isToolScript(f))
}

function countUtilsShimRefs(mod, shimFile, sources, shimPath) {
  const escaped = mod.replace('.', '\\.')
  const patterns = [
    new RegExp(`from ['"].*utils/${escaped}(?:\\.ts)?['"]`),
    new RegExp(`from ['"].*server/utils/${escaped}(?:\\.ts)?['"]`),
    new RegExp(`require\\(['"].*utils/${escaped}(?:\\.ts)?['"]\\)`)
  ]
  let refs = 0
  for (const file of sources) {
    if (path.normalize(file) === path.normalize(shimPath)) continue
    if (!fs.existsSync(file)) continue
    const c = fs.readFileSync(file, 'utf8')
    if (patterns.some((re) => re.test(c))) refs++
  }
  return refs
}

const sources = allSourceFiles()
const shims = fs.readdirSync(utilsDir).filter(
  (f) => (f.startsWith('managerGraph.') || f.startsWith('managerGraph')) && f.endsWith('.ts')
)

let deleted = 0
let kept = 0
const keptList = []

for (const shimFile of shims) {
  const mod = shimFile.replace(/\.ts$/, '')
  const shimPath = path.join(utilsDir, shimFile)
  const refs = countUtilsShimRefs(mod, shimFile, sources, shimPath)
  if (refs > 0) {
    kept++
    keptList.push(`${mod} (${refs})`)
  } else {
    deleted++
    console.log('delete:', shimFile)
    if (!dryRun) fs.unlinkSync(shimPath)
  }
}

console.log(`Done. deleted=${deleted} kept=${kept}${dryRun ? ' (dry-run)' : ''}`)
if (keptList.length) console.log('kept:', keptList.join(', '))
