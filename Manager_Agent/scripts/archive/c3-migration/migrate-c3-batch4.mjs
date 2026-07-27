/**
 * C3 batch-4: graph state/wire/final/llm remaining layer shim imports → canonical subdirs.
 * Safe word-boundary: plan' but NOT managerGraph.planValidate'.
 * Usage: node scripts/migrate-c3-batch4.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const root = process.cwd()

/** [pattern, replacement] — pattern uses negative lookahead for known suffix modules */
const REPLACEMENTS = [
  [/managerGraph\.plan(?!Validate|Parallel|Preview|Quality|Shortcuts|StepsEvent|Blueprint|Repair|Linter)/g, 'plan'],
  [/managerGraph\.shared(?!TaskStack)/g, 'shared'],
  [/managerGraph\.text(?!\.ts)/g, 'text'],
  [/managerGraph\.layeredMemory/g, 'layeredMemory'],
  [/managerGraph\.unifiedLearning/g, 'unifiedLearning'],
  [/managerGraph\.stepIsolation/g, 'stepIsolation'],
  [/managerGraph\.proPuStack/g, 'proPuStack'],
  [/managerGraph\.agentExecutors/g, 'executors'],
  [/managerGraph\.taskOrchestratorLlm/g, 'taskOrchestrator']
]

const GRAPH_LAYER_SHIMS = [
  'server/graph/core/plan.ts',
  'server/graph/core/shared.ts',
  'server/graph/core/managerGraph.text.ts',
  'server/graph/core/layeredMemory.ts',
  'server/graph/core/unifiedLearning.ts',
  'server/graph/core/stepIsolation.ts',
  'server/graph/core/proPuStack.ts',
  'server/graph/core/executors.ts',
  'server/graph/llm/taskOrchestrator.ts'
]

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

function migrateLayerImports() {
  let changed = 0
  const dirs = [
    path.join(root, 'server/graph'),
    path.join(root, 'scripts'),
    path.join(root, 'shared')
  ]
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      if (GRAPH_LAYER_SHIMS.some((s) => file.replace(/\\/g, '/').endsWith(s))) continue
      const raw = fs.readFileSync(file, 'utf8')
      let content = raw.replace(/\r\n/g, '\n')
      let fileChanged = false
      for (const [re, to] of REPLACEMENTS) {
        const next = content.replace(re, to)
        if (next !== content) {
          content = next
          fileChanged = true
        }
      }
      if (fileChanged) {
        changed++
        console.log('layer:', path.relative(root, file))
        if (!dryRun) fs.writeFileSync(file, raw.includes('\r\n') ? content.replace(/\n/g, '\r\n') : content, 'utf8')
      }
    }
  }
  return changed
}

function countShimRefs(shimPath) {
  const mod = path.basename(shimPath, '.ts')
  const importRe = new RegExp(`from ['"][^'"]*${mod.replace('.', '\\.')}(?:\\.ts)?['"]`)
  let refs = 0
  for (const file of walk(path.join(root, 'server'))) {
    if (path.normalize(file) === path.normalize(path.join(root, shimPath))) continue
    if (importRe.test(fs.readFileSync(file, 'utf8'))) refs++
  }
  for (const file of walk(path.join(root, 'scripts'))) {
    if (file.includes('archive')) continue
    const c = fs.readFileSync(file, 'utf8')
    if (importRe.test(c) || c.includes(shimPath.replace(/\//g, '\\')) || c.includes(shimPath)) refs++
  }
  return refs
}

function deleteGraphLayerShims() {
  let deleted = 0
  for (const shim of GRAPH_LAYER_SHIMS) {
    const p = path.join(root, shim)
    if (!fs.existsSync(p)) continue
    const refs = countShimRefs(shim)
    if (refs > 0) {
      console.warn(`skip delete ${shim} (${refs} refs)`)
      continue
    }
    deleted++
    console.log('delete graph shim:', shim)
    if (!dryRun) fs.unlinkSync(p)
  }
  return deleted
}

const migrated = migrateLayerImports()
const deletedGraph = deleteGraphLayerShims()
console.log(`Done batch-4. migrated=${migrated} deletedGraphShims=${deletedGraph}${dryRun ? ' (dry-run)' : ''}`)
