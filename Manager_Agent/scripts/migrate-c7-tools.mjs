/**
 * C7-4: move long-term governance .mjs → scripts/tools/
 *
 * Usage:
 *   node scripts/migrate-c7-tools.mjs --dry-run
 *   node scripts/migrate-c7-tools.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const root = process.cwd()
const scriptsDir = path.join(root, 'scripts')
const toolsDir = path.join(scriptsDir, 'tools')

/** basename → stay at scripts/ root (CI / npm scripts) */
const KEEP_AT_ROOT = new Set([
  'check-eval-golden-all.mjs',
  'check-eval-golden.mjs',
  'check-eval-route-golden.mjs',
  'gate-nlu-regression.mjs',
  'e2e-golden-paths.mjs',
  'nlu-metrics-report.mjs',
  'policy-rollback.mjs',
  'vector-reindex.mjs',
  'start-agents.js',
  'migrate-c7-tools.mjs',
  'README.md'
])

const TOOL_PREFIXES = ['migrate-', 'fix-', 'repair-', 'reorg-', 'delete-', 'trim-', 'scan-', 'slim-']
const TOOL_EXACT = new Set(['check-split-imports.mjs', 'reorg-manager-graph.mjs'])

function shouldMove(name) {
  if (KEEP_AT_ROOT.has(name)) return false
  if (TOOL_EXACT.has(name)) return true
  return TOOL_PREFIXES.some((p) => name.startsWith(p))
}

function updateReferences(fromBase, toRel) {
  const files = []
  for (const dir of ['scripts', 'doc', 'package.json']) {
    const p = path.join(root, dir)
    if (!fs.existsSync(p)) continue
    if (p.endsWith('package.json')) {
      files.push(p)
      continue
    }
    walk(p, files)
  }
  let n = 0
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8')
    const next = raw.replaceAll(`scripts/${fromBase}`, `scripts/${toRel}`)
    if (next !== raw) {
      n++
      console.log('ref:', path.relative(root, file))
      if (!dryRun) fs.writeFileSync(file, next, 'utf8')
    }
  }
  return n
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'tools' || e.name === 'archive' || e.name === 'smoke' || e.name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(mjs|md|json|ts)$/.test(e.name)) out.push(p)
  }
}

if (!dryRun) fs.mkdirSync(toolsDir, { recursive: true })

let moved = 0
for (const name of fs.readdirSync(scriptsDir)) {
  if (!shouldMove(name)) continue
  const src = path.join(scriptsDir, name)
  if (!fs.statSync(src).isFile()) continue
  const dest = path.join(toolsDir, name)
  moved++
  console.log('move:', name, '→ tools/')
  if (!dryRun) fs.renameSync(src, dest)
  updateReferences(name, `tools/${name}`)
}

console.log(`Done C7-4: moved=${moved}${dryRun ? ' (dry-run)' : ''}`)
