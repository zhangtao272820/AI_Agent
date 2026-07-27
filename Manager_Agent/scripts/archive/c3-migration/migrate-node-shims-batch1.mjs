/**
 * C3 batch-1: graph/nodes layer shims → canonical subdirs.
 * Updates graph/state imports + utils shims, then deletes nodes/managerGraph.*Node.ts shims.
 * Usage: node scripts/migrate-node-shims-batch1.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const root = process.cwd()

const SHIM_TO_CANONICAL = {
  'managerGraph.decomposeNode': 'decompose',
  'managerGraph.evaluatorNode': 'evaluator',
  'managerGraph.execNodes': 'exec',
  'managerGraph.finalNodes': 'final',
  'managerGraph.fixNode': 'fix',
  'managerGraph.intentClassifyNode': 'intentClassify',
  'managerGraph.metaNodes': 'meta',
  'managerGraph.modeNode': 'mode',
  'managerGraph.monitorNode': 'monitor',
  'managerGraph.multiNode': 'multi',
  'managerGraph.optimizerNode': 'optimizer',
  'managerGraph.orchestrateNode': 'orchestrate',
  'managerGraph.planLinterNode': 'planLinter',
  'planNode': 'plan',
  'managerGraph.planPreviewNode': 'planPreview',
  'managerGraph.prefetchNode': 'prefetch',
  'managerGraph.probeNode': 'probe',
  'managerGraph.resourceNode': 'resource',
  'managerGraph.routerNode': 'router',
  'managerGraph.schedulerNode': 'scheduler',
  'managerGraph.searchNode': 'search',
  'managerGraph.securityNode': 'security',
  'managerGraph.toolHealthNode': 'toolHealth',
  'managerGraph.turnScopeNode': 'turnScope',
  'managerGraph.voteAggregatorNode': 'voteAggregator'
}

function walkTs(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkTs(p, out)
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

function migrateImports(content) {
  let c = content
  for (const [shim, canonical] of Object.entries(SHIM_TO_CANONICAL)) {
    c = c.replaceAll(`/${shim}'`, `/${canonical}'`)
    c = c.replaceAll(`/${shim}"`, `/${canonical}"`)
  }
  return c
}

function migrateUtilsShim(content, shimName, canonical) {
  return content
    .replace(
      `/** @deprecated import from \`server/graph/nodes/${shimName}.ts\` — shim for B2 reorg */`,
      `/** @deprecated import from \`server/graph/nodes/${canonical}\` — shim for B2 reorg */`
    )
    .replace(`export * from '../graph/nodes/${shimName}'`, `export * from '../graph/nodes/${canonical}'`)
}

// Ensure final/index.ts exists
const finalIndex = path.join(root, 'server/graph/nodes/final/index.ts')
const finalIndexContent = `export { createFinalNodes, type CreateFinalNodesDeps } from './createFinalNodes'\n`
if (!fs.existsSync(finalIndex)) {
  console.log('create final/index.ts')
  if (!dryRun) fs.writeFileSync(finalIndex, finalIndexContent, 'utf8')
}

const importTargets = [
  path.join(root, 'server/graph/state'),
  path.join(root, 'server/graph/state/wire')
]
let importFilesChanged = 0
for (const dir of importTargets) {
  for (const file of walkTs(dir)) {
    const raw = fs.readFileSync(file, 'utf8')
    const next = migrateImports(raw)
    if (next !== raw) {
      importFilesChanged++
      console.log('import:', path.relative(root, file))
      if (!dryRun) fs.writeFileSync(file, raw.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next, 'utf8')
    }
  }
}

let utilsChanged = 0
for (const [shim, canonical] of Object.entries(SHIM_TO_CANONICAL)) {
  const utilsShim = path.join(root, 'server/utils', `${shim}.ts`)
  if (!fs.existsSync(utilsShim)) continue
  const raw = fs.readFileSync(utilsShim, 'utf8')
  const next = migrateUtilsShim(raw, shim, canonical)
  if (next !== raw) {
    utilsChanged++
    console.log('utils shim:', path.relative(root, utilsShim))
    if (!dryRun) fs.writeFileSync(utilsShim, raw.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next, 'utf8')
  }
}

let deleted = 0
for (const shim of Object.keys(SHIM_TO_CANONICAL)) {
  const shimPath = path.join(root, 'server/graph/nodes', `${shim}.ts`)
  if (!fs.existsSync(shimPath)) continue
  deleted++
  console.log('delete shim:', path.relative(root, shimPath))
  if (!dryRun) fs.unlinkSync(shimPath)
}

console.log(`Done. imports=${importFilesChanged} utils=${utilsChanged} deleted=${deleted}${dryRun ? ' (dry-run)' : ''}`)
