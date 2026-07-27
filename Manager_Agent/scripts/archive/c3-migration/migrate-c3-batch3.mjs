/**
 * C3 batch-3: server/api, plugins, shared, utils/domain → graph canonical imports.
 * Also migrates graph orchestrate/llm remaining core shim paths (proPuStack etc.).
 * Usage: node scripts/migrate-c3-batch3.mjs [--dry-run]
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
  'server/graph/llm/taskOrchestrator.ts': 'server/graph/llm/taskOrchestrator',
  'server/graph/state/managerGraph.ts': 'server/graph/state/createManagerGraph',
  'server/graph/state/managerGraph.invokeConfig.ts': 'server/graph/state/managerGraph.invokeConfig',
  'server/graph/state/managerGraph.graph.ts': 'server/graph/state/managerGraph.graph',
  'server/graph/state/managerGraph.state.ts': 'server/graph/state/managerGraph.state'
}

function normalizeNewlines(s) {
  return s.replace(/\r\n/g, '\n')
}

function resolveShimTarget(filePath) {
  const abs = path.join(root, filePath)
  if (!fs.existsSync(abs)) return filePath.replace(/\.ts$/, '')
  const content = fs.readFileSync(abs, 'utf8')
  // Only follow barrel shims (export * from './subdir'), not real modules with named re-exports
  const reExport = content.match(/^\/\*\*[\s\S]*?\*\/\s*\nexport \* from '\.\/([^']+)'/m)
    || content.match(/^export \* from '\.\/([^']+)'/m)
  if (reExport) {
    const dir = path.dirname(filePath)
    const sub = reExport[1].replace(/\/index$/, '')
    const resolved = path.join(dir, sub).replace(/\\/g, '/')
    const resolvedFile = resolved + '.ts'
    if (CORE_SHIM_TO_CANONICAL[resolvedFile]) return CORE_SHIM_TO_CANONICAL[resolvedFile]
    return resolved
  }
  return filePath.replace(/\.ts$/, '')
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
    map.set(mod, resolveShimTarget(target))
  }
  return map
}

function relImport(fromFile, canonicalPath) {
  const fromDir = path.dirname(fromFile)
  let rel = path.relative(fromDir, path.join(root, canonicalPath)).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

function walkFiles(dir, out = [], skipArchive = true) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (skipArchive && e.name === 'archive') continue
      if (e.name === 'node_modules') continue
      walkFiles(p, out, skipArchive)
    } else if (/\.(ts|vue|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

function migrateUtilsImports(utilsMap) {
  const dirs = [
    path.join(root, 'server/api'),
    path.join(root, 'server/plugins'),
    path.join(root, 'shared'),
    path.join(root, 'server/utils')
  ]
  let changed = 0
  for (const dir of dirs) {
    for (const file of walkFiles(dir)) {
      if (file.replace(/\\/g, '/').includes('/server/utils/managerGraph.')) continue
      const raw = fs.readFileSync(file, 'utf8')
      let content = normalizeNewlines(raw)
      let fileChanged = false
      for (const [mod, canonical] of utilsMap) {
        const rel = relImport(file, canonical)
        const escaped = mod.replace('.', '\\.')
        const patterns = [
          new RegExp(`(['"\`])(?:\\.\\./)+utils/${escaped}(?:\\.ts)?\\1`, 'g'),
          new RegExp(`(['"\`])(?:\\.\\./)+server/utils/${escaped}(?:\\.ts)?\\1`, 'g'),
          new RegExp(`(['"\`])\\.\\./${escaped}(?:\\.ts)?\\1`, 'g'),
          new RegExp(`(['"\`])\\.\\./\\.\\./${escaped}(?:\\.ts)?\\1`, 'g'),
          new RegExp(`(['"\`])\\.\\./\\.\\./\\.\\./${escaped}(?:\\.ts)?\\1`, 'g')
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
        console.log('utils→graph:', path.relative(root, file))
        if (!dryRun) fs.writeFileSync(file, raw.includes('\r\n') ? content.replace(/\n/g, '\r\n') : content, 'utf8')
      }
    }
  }
  return changed
}

/** graph internal: proPuStack → proPuStack (word-boundary safe) */
function migrateGraphCoreShimPaths() {
  const replacements = [
    [/managerGraph\.proPuStack(?!\\w)/g, 'proPuStack'],
    [/managerGraph\.taskOrchestratorLlm(?!\\w)/g, 'taskOrchestrator']
  ]
  let changed = 0
  for (const file of walkFiles(path.join(root, 'server/graph'))) {
    const raw = fs.readFileSync(file, 'utf8')
    let content = normalizeNewlines(raw)
    let fileChanged = false
    for (const [re, to] of replacements) {
      const next = content.replace(re, to)
      if (next !== content) {
        content = next
        fileChanged = true
      }
    }
    if (fileChanged) {
      changed++
      console.log('graph shim:', path.relative(root, file))
      if (!dryRun) fs.writeFileSync(file, raw.includes('\r\n') ? content.replace(/\n/g, '\r\n') : content, 'utf8')
    }
  }
  return changed
}

const utilsMap = buildUtilsToCanonicalMap()
console.log(`utils map: ${utilsMap.size} modules`)
const utilsChanged = migrateUtilsImports(utilsMap)
const graphChanged = migrateGraphCoreShimPaths()
console.log(`Done. utils=${utilsChanged} graph=${graphChanged}${dryRun ? ' (dry-run)' : ''}`)
