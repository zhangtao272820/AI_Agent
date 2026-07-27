/**
 * C5b: strip managerGraph. prefix from server/graph/{llm,orchestrate,state}/*.ts
 *
 * Usage:
 *   node scripts/migrate-c5b-rename-layers.mjs --dry-run
 *   node scripts/migrate-c5b-rename-layers.mjs
 *   node scripts/migrate-c5b-rename-layers.mjs --delete-shims
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const deleteShims = args.includes('--delete-shims')
const root = process.cwd()
const graphDir = path.join(root, 'server/graph')

/** layer → [module basename without managerGraph. prefix] */
const C5B_LAYERS = {
  llm: [
    'turnScopeLlm',
    'webTaskStructuralLlm',
    'intentClassifyLlm',
    'writeGateLlm',
    'intentUnderstandLlm',
    'mediaRouteLlm',
    'evaluatorLlm',
    'planBlueprintLlm',
    'userIntentAlignLlm',
    'securityLlm',
    'pipelineHintsLlm',
    'routerConfirmLlm',
    'taskStackIngestLlm',
    'planRepairLlm',
    'taskConstraintsLlm',
    'orchestratorJudgeLlm',
    'mediaPlanLlm'
  ],
  orchestrate: [
    'unifiedOrchestrate',
    'orchestratorStructuralLint',
    'routeOrchestration',
    'professionalOrchestrate',
    'orchestratorHeuristic',
    'unifiedRouting',
    'orchestratorCapPolicy',
    'chatOrchestrate',
    'orchestratorPipeline',
    'puStackOrchestratorMerge',
    'orchestrationNarrative',
    'orchestratorInvariants',
    'puStackOrchestratorAuthority'
  ],
  state: ['runtimeBundle', 'invokeConfig', 'graph', 'state', 'graphEntry']
}

/** state/ special: managerGraphRuntimeBundle.ts → runtimeBundle.ts */
const STATE_SPECIAL = {
  managerGraphRuntimeBundle: 'runtimeBundle',
  managerGraph: 'graphEntry'
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'archive') continue
      walk(p, out)
    } else if (/\.(ts|vue|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

function relImport(fromFile, targetNoExt) {
  const fromDir = path.dirname(fromFile)
  let rel = path.relative(fromDir, path.join(root, targetNoExt)).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

function oldSeg(layer, mod) {
  return layer === 'state' && mod === 'runtimeBundle'
    ? 'managerGraphRuntimeBundle'
    : layer === 'state' && mod === 'graphEntry'
      ? 'managerGraph'
      : `managerGraph.${mod}`
}

function newPath(layer, mod) {
  const file = mod === 'runtimeBundle' ? 'runtimeBundle.ts' : mod === 'graphEntry' ? 'graphEntry.ts' : `${mod}.ts`
  return path.join(graphDir, layer, file)
}

function migrateImports(mappings) {
  const files = [
    ...walk(path.join(root, 'server')),
    ...walk(path.join(root, 'scripts')),
    ...walk(path.join(root, 'shared'))
  ].filter((f) => !f.includes('migrate-c5b-rename-layers.mjs'))

  let changed = 0
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8')
    let next = raw.replace(/\r\n/g, '\n')
    let fileChanged = false

    for (const { layer, mod, oldName, newName } of mappings) {
      const canonical = `server/graph/${layer}/${newName.replace(/\.ts$/, '')}`
      const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      next = next.replace(new RegExp(`(/${layer}/)${esc}(?!/)`, 'g'), `/${layer}/${newName.replace(/\.ts$/, '')}`)
      next = next.replace(
        new RegExp(`(from\\s+['"])(\\.\\.\\/)+${esc}(?:\\.ts)?(['"])`, 'g'),
        (_m, pre, _dots, post) => `${pre}${relImport(file, canonical)}${post}`
      )
      next = next.replace(
        new RegExp(`(from\\s+['"])\\./${esc}(?:\\.ts)?(['"])`, 'g'),
        (_m, pre, post) => `${pre}${relImport(file, canonical)}${post}`
      )
      next = next.replace(
        new RegExp(`import\\(\\s*(['"])(\\.\\.\\/)+${esc}(?:\\.ts)?(['"])\\s*\\)`, 'g'),
        (_m, pre, _dots, post) => `import(${pre}${relImport(file, canonical)}${post})`
      )
    }

    if (next !== raw.replace(/\r\n/g, '\n')) {
      fileChanged = true
    }
    if (fileChanged) {
      changed++
      console.log('import:', path.relative(root, file))
      if (!dryRun) fs.writeFileSync(file, raw.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next, 'utf8')
    }
  }
  return changed
}

function fixMovedRelativeImports(mappings) {
  let fixed = 0
  for (const { layer, mod, newName } of mappings) {
    const filePath = newPath(layer, mod)
    if (!fs.existsSync(filePath)) continue
    const raw = fs.readFileSync(filePath, 'utf8')
    let next = raw.replace(/\r\n/g, '\n')
    for (const other of mappings) {
      if (other.layer !== layer) continue
      const esc = `managerGraph\\.${other.mod}`
      next = next.replace(
        new RegExp(`(from\\s+['"])\\.\\/${esc}(?:\\.ts)?(['"])`, 'g'),
        (_m, pre, post) => `${pre}./${other.newName.replace(/\.ts$/, '')}${post}`
      )
    }
    next = next.replace(/(from\s+['"])\.\.\/core\/managerGraph\./g, (_m, pre) => `${pre}../core/`)
    next = next.replace(/(from\s+['"])\.\.\/core\/([a-zA-Z]+)\//g, (_m, pre, d) => `${pre}../core/${d}/`)
    if (next !== raw.replace(/\r\n/g, '\n')) {
      fixed++
      console.log('fix relative:', path.relative(root, filePath))
      if (!dryRun) fs.writeFileSync(filePath, raw.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next, 'utf8')
    }
  }
  return fixed
}

function buildMappings() {
  const mappings = []
  for (const [layer, mods] of Object.entries(C5B_LAYERS)) {
    for (const mod of mods) {
      const oldName = oldSeg(layer, mod)
      const newName = mod === 'graphEntry' ? 'graphEntry.ts' : `${mod}.ts`
      mappings.push({ layer, mod, oldName, newName })
    }
  }
  return mappings
}

function renameFiles(mappings) {
  let moved = 0
  for (const { layer, mod, oldName, newName } of mappings) {
    const oldPath =
      layer === 'state' && mod === 'runtimeBundle'
        ? path.join(graphDir, layer, 'managerGraphRuntimeBundle.ts')
        : layer === 'state' && mod === 'graphEntry'
          ? path.join(graphDir, layer, 'managerGraph.ts')
          : path.join(graphDir, layer, `${oldName}.ts`)
    const target = newPath(layer, mod)
    if (!fs.existsSync(oldPath)) {
      console.warn('skip missing:', path.relative(root, oldPath))
      continue
    }
    moved++
    console.log('rename:', path.relative(root, oldPath), '→', path.relative(root, target))
    if (!dryRun) {
      fs.renameSync(oldPath, target)
      fs.writeFileSync(
        oldPath,
        `/** C5b: re-export — remove after imports migrated */\nexport * from './${newName.replace(/\.ts$/, '')}'\n`,
        'utf8'
      )
    }
  }
  return moved
}

function deleteShimsFn(mappings) {
  let deleted = 0
  for (const { layer, mod, oldName } of mappings) {
    const shim =
      layer === 'state' && mod === 'runtimeBundle'
        ? path.join(graphDir, layer, 'managerGraphRuntimeBundle.ts')
        : layer === 'state' && mod === 'graphEntry'
          ? path.join(graphDir, layer, 'managerGraph.ts')
          : path.join(graphDir, layer, `${oldName}.ts`)
    if (!fs.existsSync(shim)) continue
    const c = fs.readFileSync(shim, 'utf8')
    if (!c.includes('C5b: re-export')) continue
    deleted++
    console.log('delete shim:', path.relative(root, shim))
    if (!dryRun) fs.unlinkSync(shim)
  }
  return deleted
}

function writeBarrel(layer, mappings) {
  const indexPath = path.join(graphDir, layer, 'index.ts')
  const layerMods = mappings.filter((m) => m.layer === layer).map((m) => m.newName.replace(/\.ts$/, ''))
  const lines = layerMods.map((m) => `export * from './${m}'`)
  let merged = lines
  if (fs.existsSync(indexPath)) {
    const cur = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n')
    const existing = cur
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^export \* from '\.\//.test(l))
    merged = [...new Set([...existing, ...lines])]
  }
  const body = merged.join('\n') + '\n'
  console.log('write barrel:', `${layer}/index.ts`)
  if (!dryRun) fs.writeFileSync(indexPath, body, 'utf8')
}

const mappings = buildMappings()

if (deleteShims) {
  console.log(`Deleted ${deleteShimsFn(mappings)} shims`)
  process.exit(0)
}

console.log(`\n=== C5b layers=${Object.keys(C5B_LAYERS).join(',')}${dryRun ? ' (dry-run)' : ''} ===`)
const moved = renameFiles(mappings)
const fixed = fixMovedRelativeImports(mappings)
const changed = migrateImports(mappings)
for (const layer of Object.keys(C5B_LAYERS)) writeBarrel(layer, mappings)
console.log(`Done: moved=${moved} relativeFixed=${fixed} importFilesChanged=${changed}`)
