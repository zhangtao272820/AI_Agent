/**
 * B6: delete server/utils/*.ts domain re-export shims after migrate-b6-utils-domains.mjs.
 * Usage: node scripts/delete-b6-utils-shims.mjs [--dry-run]
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
    } else if (/\.(ts|vue|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

function isToolScript(file) {
  const rel = path.relative(root, file).replace(/\\/g, '/')
  if (rel.startsWith('scripts/archive/')) return true
  if (/^scripts\/(migrate-|delete-b6|delete-zero-ref|reorg-utils)/.test(rel)) return true
  return false
}

function countShimRefs(mod, domain, sources, shimPath) {
  const esc = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`from ['"].*utils/${esc}(?!/)`),
    new RegExp(`from ['"].*server/utils/${esc}(?!/)`),
    new RegExp(`from ['"](?:\\.\\./)+${esc}(?:\\.ts)?['"]`)
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

const sources = walk(path.join(root, 'server'), []).concat(
  walk(path.join(root, 'scripts'), []),
  walk(path.join(root, 'shared'), [])
).filter((f) => !isToolScript(f))

if (fs.existsSync(path.join(root, 'nuxt.config.ts'))) sources.push(path.join(root, 'nuxt.config.ts'))

const shims = fs.readdirSync(utilsDir).filter((f) => {
  if (!f.endsWith('.ts')) return false
  const c = fs.readFileSync(path.join(utilsDir, f), 'utf8')
  return c.includes('B6: utils domain reorg')
})

let deleted = 0
let kept = 0
const keptList = []

for (const shimFile of shims) {
  const mod = shimFile.replace(/\.ts$/, '')
  const m = fs.readFileSync(path.join(utilsDir, shimFile), 'utf8').match(/export \* from '\.\/([^/]+)\//)
  const domain = m ? m[1] : '?'
  const shimPath = path.join(utilsDir, shimFile)
  const refs = countShimRefs(mod, domain, sources, shimPath)
  if (refs > 0) {
    kept++
    keptList.push(`${mod} (${refs})`)
  } else {
    deleted++
    console.log('delete:', shimFile)
    if (!dryRun) fs.unlinkSync(shimPath)
  }
}

console.log(`Done B6 delete. deleted=${deleted} kept=${kept}${dryRun ? ' (dry-run)' : ''}`)
if (keptList.length) console.log('kept:', keptList.join(', '))
