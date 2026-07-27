/**
 * B6: migrate imports from server/utils/{mod} shims → server/utils/{domain}/{mod}.
 * Usage: node scripts/migrate-b6-utils-domains.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const root = process.cwd()
const utilsDir = path.join(root, 'server/utils')

function buildB6Map() {
  const map = new Map()
  for (const f of fs.readdirSync(utilsDir)) {
    if (!f.endsWith('.ts')) continue
    const content = fs.readFileSync(path.join(utilsDir, f), 'utf8')
    if (!content.includes('B6: utils domain reorg')) continue
    const m = content.match(/export \* from '\.\/([^/]+)\/([^']+)'/)
    if (!m) continue
    map.set(f.replace(/\.ts$/, ''), { domain: m[1], file: m[2] })
  }
  return map
}

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

function allTargetFiles() {
  const files = []
  for (const d of ['server', 'scripts', 'shared', '.']) {
    if (d === '.') {
      for (const f of ['nuxt.config.ts']) {
        const p = path.join(root, f)
        if (fs.existsSync(p)) files.push(p)
      }
      continue
    }
    walk(path.join(root, d), files)
  }
  return files.filter((f) => {
    const rel = path.relative(utilsDir, f).replace(/\\/g, '/')
    if (!rel.startsWith('..') && rel.endsWith('.ts') && !rel.includes('/')) return false
    return true
  })
}

function migrateContent(content, b6Map) {
  let next = content.replace(/\r\n/g, '\n')
  for (const [mod, { domain }] of b6Map) {
    const esc = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const canonicalSeg = `${domain}/${mod}`

    if (new RegExp(`utils/${canonicalSeg}(?:\\.ts)?`).test(next)) continue

    next = next.replace(
      new RegExp(`(utils/)(${esc})(?!/)`, 'g'),
      `$1${canonicalSeg}`
    )

    next = next.replace(
      new RegExp(`(from\\s+['"])(\\.\\.\\/)+(${esc})(?:\\.ts)?(['"])`, 'g'),
      (full, pre, dots, _mod, post) => {
        const prefix = `${pre}${dots}`
        if (full.includes(`${domain}/${mod}`)) return full
        return `${prefix}${domain}/${mod}${post}`
      }
    )

    next = next.replace(
      new RegExp(`(import\\(['"])(\\.\\.\\/)+(${esc})(?:\\.ts)?(['"]\\))`, 'g'),
      (full, pre, dots, _mod, post) => {
        if (full.includes(`${domain}/${mod}`)) return full
        return `${pre}${dots}${domain}/${mod}${post}`
      }
    )
  }
  return next
}

const b6Map = buildB6Map()
console.log(`B6 shims to migrate: ${b6Map.size}`)

let changed = 0
for (const file of allTargetFiles()) {
  const raw = fs.readFileSync(file, 'utf8')
  const next = migrateContent(raw, b6Map)
  if (next !== raw.replace(/\r\n/g, '\n')) {
    changed++
    console.log('migrate:', path.relative(root, file))
    if (!dryRun) {
      fs.writeFileSync(file, raw.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next, 'utf8')
    }
  }
}

console.log(`Done B6 migrate. changed=${changed}${dryRun ? ' (dry-run)' : ''}`)
