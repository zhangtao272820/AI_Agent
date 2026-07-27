/**
 * C3 batch-2: smoke/scripts utils shims → graph canonical; core/llm layer shims → subdirs.
 * Usage: node scripts/migrate-c3-batch2.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const root = process.cwd()

const CORE_SHIM_TO_CANONICAL = {
  'server/graph/core/plan.ts': 'server/graph/core/plan',
  'server/graph/core/shared.ts': 'server/graph/core/shared',
  'server/graph/core/managerGraph.text.ts': 'server/graph/core/text',
  'server/graph/core/executors.ts': 'server/graph/core/executors',
  'server/graph/core/layeredMemory.ts': 'server/graph/core/layeredMemory',
  'server/graph/core/unifiedLearning.ts': 'server/graph/core/unifiedLearning',
  'server/graph/core/stepIsolation.ts': 'server/graph/core/stepIsolation',
  'server/graph/core/proPuStack.ts': 'server/graph/core/proPuStack',
  'server/graph/llm/taskOrchestrator.ts': 'server/graph/llm/taskOrchestrator'
}

function normalizeNewlines(s) {
  return s.replace(/\r\n/g, '\n')
}

function resolveShimTarget(filePath) {
  const abs = path.join(root, filePath)
  if (!fs.existsSync(abs)) return filePath.replace(/\.ts$/, '')
  const content = fs.readFileSync(abs, 'utf8')
  const m = content.match(/export \* from '\.\/([^']+)'/)
  if (!m) return filePath.replace(/\.ts$/, '')
  const dir = path.dirname(filePath)
  const sub = m[1].replace(/\/index$/, '')
  const resolved = path.join(dir, sub).replace(/\\/g, '/')
  const resolvedFile = resolved + '.ts'
  if (CORE_SHIM_TO_CANONICAL[resolvedFile]) return CORE_SHIM_TO_CANONICAL[resolvedFile]
  if (CORE_SHIM_TO_CANONICAL[resolved + '/index.ts']) return CORE_SHIM_TO_CANONICAL[resolved + '/index.ts']
  return resolved
}

function buildUtilsToCanonicalMap() {
  const map = new Map()
  const utilsDir = path.join(root, 'server/utils')
  for (const f of fs.readdirSync(utilsDir)) {
    if (!f.startsWith('managerGraph.') || !f.endsWith('.ts')) continue
    const mod = f.replace(/\.ts$/, '')
    const content = fs.readFileSync(path.join(utilsDir, f), 'utf8')
    const m = content.match(/export \* from '([^']+)'/)
    if (!m) continue
    let target = path.normalize(path.join('server/utils', m[1])).replace(/\\/g, '/')
    if (!target.endsWith('.ts')) target += '.ts'
    const canonical = resolveShimTarget(target)
    map.set(mod, canonical)
  }
  return map
}

function relImport(fromFile, canonicalPath) {
  const fromDir = path.dirname(fromFile)
  let rel = path.relative(fromDir, path.join(root, canonicalPath)).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'archive' || e.name === 'node_modules') continue
      walkFiles(p, out)
    } else if (/\.(ts|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

function migrateSmokeImports(utilsMap) {
  let changed = 0
  const dirs = [path.join(root, 'scripts'), path.join(root, 'server/utils/route')]
  for (const dir of dirs) {
    for (const file of walkFiles(dir)) {
      const raw = fs.readFileSync(file, 'utf8')
      let content = normalizeNewlines(raw)
      let fileChanged = false
      for (const [mod, canonical] of utilsMap) {
        const rel = relImport(file, canonical)
        const patterns = [
          new RegExp(`(['"])(\\.\\./)+server/utils/${mod.replace('.', '\\.')}(?:\\.ts)?\\1`, 'g'),
          new RegExp(`(['"])(\\.\\./)+utils/${mod.replace('.', '\\.')}(?:\\.ts)?\\1`, 'g')
        ]
        for (const re of patterns) {
          const next = content.replace(re, `$1${rel}$1`)
          if (next !== content) {
            content = next
            fileChanged = true
          }
        }
      }
      if (fileChanged) {
        changed++
        console.log('smoke:', path.relative(root, file))
        if (!dryRun) fs.writeFileSync(file, raw.includes('\r\n') ? content.replace(/\n/g, '\r\n') : content, 'utf8')
      }
    }
  }
  return changed
}

const CORE_SHIM_IMPORTS = [
  ['../plan', '../plan'],
  ['../shared', '../shared'],
  ['../text', '../text'],
  ['../executors', '../executors'],
  ['../layeredMemory', '../layeredMemory'],
  ['../unifiedLearning', '../unifiedLearning'],
  ['../stepIsolation', '../stepIsolation'],
  ['../proPuStack', '../proPuStack'],
  ['./plan', './plan'],
  ['./shared', './shared'],
  ['./text', './text'],
  ['./executors', './executors'],
  ['./layeredMemory', './layeredMemory'],
  ['./unifiedLearning', './unifiedLearning'],
  ['./stepIsolation', './stepIsolation'],
  ['./proPuStack', './proPuStack'],
  ['../../core/plan', '../../core/plan'],
  ['../../core/shared', '../../core/shared'],
  ['../../core/text', '../../core/text'],
  ['../../core/executors', '../../core/executors'],
  ['../../core/stepIsolation', '../../core/stepIsolation'],
  ['../../core/proPuStack', '../../core/proPuStack'],
  ['../taskOrchestrator', '../taskOrchestrator'],
  ['./taskOrchestrator', './taskOrchestrator'],
  ['../../llm/taskOrchestrator', '../../llm/taskOrchestrator']
]

function migrateGraphCoreImports() {
  let changed = 0
  const graphDir = path.join(root, 'server/graph')
  for (const file of walkFiles(graphDir)) {
    if (CORE_SHIM_IMPORTS.every(([from]) => !fs.readFileSync(file, 'utf8').includes(from))) continue
    const raw = fs.readFileSync(file, 'utf8')
    let content = normalizeNewlines(raw)
    let fileChanged = false
    for (const [from, to] of CORE_SHIM_IMPORTS) {
      if (!content.includes(from)) continue
      content = content.split(from).join(to)
      fileChanged = true
    }
    if (fileChanged) {
      changed++
      console.log('graph:', path.relative(root, file))
      if (!dryRun) fs.writeFileSync(file, raw.includes('\r\n') ? content.replace(/\n/g, '\r\n') : content, 'utf8')
    }
  }
  return changed
}

function updateUtilsShims(utilsMap) {
  let changed = 0
  for (const [mod, canonical] of utilsMap) {
    const shimPath = path.join(root, 'server/utils', `${mod}.ts`)
    if (!fs.existsSync(shimPath)) continue
    const rel = path.relative(path.join(root, 'server/utils'), path.join(root, canonical)).replace(/\\/g, '/')
    const relImport = rel.startsWith('.') ? rel : `./${rel}`
    const raw = fs.readFileSync(shimPath, 'utf8')
    const next = raw.replace(/export \* from '([^']+)'/, `export * from '${relImport}'`)
    if (next !== raw) {
      changed++
      if (!dryRun) fs.writeFileSync(shimPath, next, 'utf8')
    }
  }
  return changed
}

function deleteCoreShims() {
  let deleted = 0
  for (const shim of Object.keys(CORE_SHIM_TO_CANONICAL)) {
    const p = path.join(root, shim)
    if (!fs.existsSync(p)) continue
    const shimMod = path.basename(shim, '.ts').replace('.', '\\.')
    const importRe = new RegExp(`from ['"][^'"]*${shimMod}(?!\\w)(?:\\.ts)?['"]`)
    let refs = 0
    for (const file of walkFiles(path.join(root, 'server'))) {
      if (path.normalize(file) === path.normalize(p)) continue
      if (importRe.test(fs.readFileSync(file, 'utf8'))) refs++
    }
    if (refs > 0) {
      console.warn(`skip delete ${shim} (${refs} refs remain)`)
      continue
    }
    deleted++
    console.log('delete:', shim)
    if (!dryRun) fs.unlinkSync(p)
  }
  return deleted
}

const utilsMap = buildUtilsToCanonicalMap()
console.log(`utils map: ${utilsMap.size} modules`)
const smokeChanged = migrateSmokeImports(utilsMap)
const graphChanged = migrateGraphCoreImports()
const utilsUpdated = updateUtilsShims(utilsMap)
const deleted = deleteCoreShims()
console.log(`Done. smoke=${smokeChanged} graph=${graphChanged} utils=${utilsUpdated} deleted=${deleted}${dryRun ? ' (dry-run)' : ''}`)
