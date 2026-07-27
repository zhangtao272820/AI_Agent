/**
 * C5: rename server/graph/core/managerGraph.*.ts → core/{domain}/{name}.ts
 * and migrate imports. One domain per --batch run.
 *
 * Usage:
 *   node scripts/migrate-c5-rename-core.mjs --batch probe --dry-run
 *   node scripts/migrate-c5-rename-core.mjs --batch probe
 *   node scripts/migrate-c5-rename-core.mjs --batch probe --delete-shims
 *
 * See doc/split-cleanup-playbook.md §11
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const deleteShims = args.includes('--delete-shims')
const batchIdx = args.indexOf('--batch')
const batchName = batchIdx >= 0 ? args[batchIdx + 1] : null

const root = process.cwd()
const coreDir = path.join(root, 'server/graph/core')

/** managerGraph.{name} module basename (no prefix) per domain batch */
const C5_BATCHES = {
  probe: ['probeConfig', 'probeInterpretation', 'probeRoutingAnchor', 'agentProbe', 'prefetchGate', 'retrieverPlan'],
  rag: ['ragPrefetch', 'ragRetrievePolicy', 'ragEvidenceAlign', 'intentRagDomain', 'intentRagRecallCore', 'intentRagRecall'],
  output: [
    'composeFinal',
    'finalOutputBlocks',
    'replyPolish',
    'criticPolicy',
    'criticEvidence',
    'downstreamMetrics',
    'downstreamContext',
    'stepResultEvent',
    'outputFollowupHistory'
  ],
  db: ['dbPrefetch', 'dbStepQuestion', 'writeGate', 'evidenceGate'],
  agent: [
    'agentRegistry',
    'agentRunner',
    'agentPollutionGuard',
    'agentAnswerJudge',
    'agentCapabilities',
    'agentErrors',
    'capabilities',
    'capabilityTier',
    'guiCrawlerHandoff'
  ],
  memory: [
    'vectorMemory',
    'longMemory',
    'userProfile',
    'experienceReplay',
    'experienceWritePolicy',
    'memoryCurator',
    'multiTurnIntent',
    'userIntentSupremacy',
    'intentPlaybook'
  ],
  task: [
    'taskStack',
    'taskFetcher',
    'taskStackFinalize',
    'taskStackIngest',
    'taskStackLlmExtract',
    'taskStackSuppressions',
    'autonomousQueue',
    'autonomousPlan',
    'autonomousNotify',
    'userGoals',
    'userIdentity',
    'proactiveLoop',
    'worldModel',
    'sharedTaskStack'
  ],
  routing: [
    'clauses',
    'clausePlanBinding',
    'clauseStructuralRepair',
    'clauseMetrics',
    'routeBandit',
    'routeStrategy',
    'routeFinalize',
    'routePlanCard',
    'routeAuthority',
    'routePreferences',
    'routePolicyRl',
    'routeCausal',
    'routeStepsEvent',
    'routeUnderstandAlign',
    'proRoutePolicy',
    'dataPlaneRoutingHint',
    'nlResolve',
    'turnScope'
  ],
  evolution: [
    'plannerRules',
    'plannerRuleEvolution',
    'promptPatches',
    'promptEvolution',
    'autoEvolution',
    'artifactCanary',
    'failureInsights',
    'failureAttribution',
    'failureFixSuggestions',
    'governance',
    'evolutionHints',
    'evolutionLlmHypothesis',
    'evolutionExperiments',
    'evolutionRoutingGate',
    'evolutionVersionLift',
    'implicitLearning',
    'featureRollout',
    'policyCanary',
    'policyRollout',
    'playbookPrompts'
  ],
  runtime: [
    'runtime',
    'runtimePersistence',
    'checkpointStore',
    'checkpointRedis',
    'langgraphCheckpointer',
    'headlessRun',
    'wsAuth',
    'wsSessionHub',
    'sessionBridge',
    'internalCollaborators',
    'serviceReady',
    'runObservability',
    'otelExport',
    'metricsAggregate',
    'retryBudget',
    'conversationBudget',
    'modeIsolate',
    'stepStatus',
    'phaseLabels'
  ],
  plan: [
    'planValidate',
    'planParallel',
    'contextComposer',
    'planPreview',
    'planQuality',
    'clarifyReplan',
    'clarifySuppress',
    'clarifyContext',
    'planStepsEvent',
    'planShortcuts',
    'collabPreview'
  ],
  shared: ['llmJson', 'modelTier', 'llmSpeed']
}

function unique(arr) {
  return [...new Set(arr)]
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

function relImport(fromFile, targetNoExt) {
  const fromDir = path.dirname(fromFile)
  let rel = path.relative(fromDir, path.join(root, targetNoExt)).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

function migrateImports(modules, domain) {
  const files = [
    ...walk(path.join(root, 'server')),
    ...walk(path.join(root, 'scripts')),
    ...walk(path.join(root, 'shared'))
  ].filter((f) => !f.includes('migrate-c5-rename-core.mjs'))

  let changed = 0
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8')
    let next = raw.replace(/\r\n/g, '\n')
    let fileChanged = false

    for (const mod of modules) {
      const oldSeg = `managerGraph.${mod}`
      const canonical = `server/graph/core/${domain}/${mod}`
      if (next.includes(`/core/${domain}/${mod}`) && !next.includes(oldSeg)) continue

      const esc = oldSeg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      next = next.replace(new RegExp(`(/core/)${esc}(?!/)`, 'g'), `/core/${domain}/${mod}`)

      next = next.replace(
        new RegExp(`(from\\s+['"])(\\.\\.\\/)+${esc}(?:\\.ts)?(['"])`, 'g'),
        (_m, pre, _dots, post) => `${pre}${relImport(file, canonical)}${post}`
      )
      next = next.replace(
        new RegExp(`(from\\s+['"])\\./${esc}(?:\\.ts)?(['"])`, 'g'),
        (_m, pre, post) => `${pre}${relImport(file, canonical)}${post}`
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

/** core/ → core/{domain}/ 后，文件内相对 import 需多一层 ../ */
const CORE_SIBLING_DIRS = [
  'probe',
  'rag',
  'text',
  'plan',
  'output',
  'db',
  'agent',
  'memory',
  'task',
  'runtime',
  'evolution',
  'routing',
  'executors',
  'shared',
  'stepIsolation',
  'layeredMemory',
  'unifiedLearning',
  'proPuStack'
]

function fixMovedFileRelativeImports(modules, domain) {
  let fixed = 0
  for (const mod of modules) {
    const filePath = path.join(coreDir, domain, `${mod}.ts`)
    if (!fs.existsSync(filePath)) continue
    const raw = fs.readFileSync(filePath, 'utf8')
    let next = raw.replace(/\r\n/g, '\n')
    next = next.replace(
      /(from\s+['"])\.\/managerGraph\.([^'"]+)(['"])/g,
      (_m, pre, rest, post) => `${pre}../managerGraph.${rest}${post}`
    )
    next = next.replace(
      /import\(\s*(['"])\.\/managerGraph\.([^'"]+)(['"])\s*\)/g,
      (_m, pre, rest, post) => `import(${pre}../managerGraph.${rest}${post})`
    )
    for (const sub of CORE_SIBLING_DIRS) {
      next = next.replace(
        new RegExp(`(from\\s+['"])\\.\\/${sub}(\\/|['"])`, 'g'),
        (_m, pre, tail) => `${pre}../${sub}${tail}`
      )
    }
    // 同批已迁域：./db/ ./rag/ ./output/ 等
    for (const other of Object.keys(C5_BATCHES)) {
      if (other === domain) continue
      next = next.replace(
        new RegExp(`(from\\s+['"])\\.\\/${other}(\\/|['"])`, 'g'),
        (_m, pre, tail) => `${pre}../${other}${tail}`
      )
    }
    // core 根 → core/{domain}/：指向上层 graph 或 server 的路径加深一层
    next = next.replace(
      /(from\s+['"])\.\.\/\.\.\/(llm|orchestrate|nodes|state)\//g,
      (_m, pre, layer) => `${pre}../../../${layer}/`
    )
    next = next.replace(/(from\s+['"])\.\.\/\.\.\/utils\//g, (_m, pre) => `${pre}../../../utils/`)
    next = next.replace(/(from\s+['"])\.\.\/\.\.\/\.\.\/shared\//g, (_m, pre) => `${pre}../../../../shared/`)
    next = next.replace(/import\(\s*(['"])\.\.\/\.\.\/utils\//g, (_m, pre) => `import(${pre}../../../utils/`)
    if (next !== raw.replace(/\r\n/g, '\n')) {
      fixed++
      console.log('fix relative:', `${domain}/${mod}.ts`)
      if (!dryRun) fs.writeFileSync(filePath, raw.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next, 'utf8')
    }
  }
  return fixed
}

function renameModules(modules, domain) {
  fs.mkdirSync(path.join(coreDir, domain), { recursive: true })
  let moved = 0
  for (const mod of modules) {
    const oldPath = path.join(coreDir, `managerGraph.${mod}.ts`)
    const newPath = path.join(coreDir, domain, `${mod}.ts`)
    if (!fs.existsSync(oldPath)) {
      console.warn('skip missing:', `managerGraph.${mod}.ts`)
      continue
    }
    moved++
    console.log('rename:', `managerGraph.${mod}.ts`, '→', `${domain}/${mod}.ts`)
    if (!dryRun) {
      fs.renameSync(oldPath, newPath)
      fs.writeFileSync(
        path.join(coreDir, `managerGraph.${mod}.ts`),
        `/** C5: re-export — remove after imports migrated */\nexport * from './${domain}/${mod}'\n`,
        'utf8'
      )
    }
  }
  return moved
}

function deleteBatchShims(modules) {
  let deleted = 0
  for (const mod of modules) {
    const shim = path.join(coreDir, `managerGraph.${mod}.ts`)
    if (!fs.existsSync(shim)) continue
    const c = fs.readFileSync(shim, 'utf8')
    if (!c.includes('C5: re-export')) continue
    deleted++
    console.log('delete shim:', `managerGraph.${mod}.ts`)
    if (!dryRun) fs.unlinkSync(shim)
  }
  return deleted
}

function writeIndexBarrel(domain, modules) {
  const indexPath = path.join(coreDir, domain, 'index.ts')
  const present = modules.filter((m) => fs.existsSync(path.join(coreDir, domain, `${m}.ts`)))
  const newLines = present.map((m) => `export * from './${m}'`)
  let merged = newLines
  if (fs.existsSync(indexPath)) {
    const cur = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n')
    const existing = cur
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^export \* from '\.\//.test(l))
    merged = [...new Set([...existing, ...newLines])]
  }
  const body = merged.join('\n') + '\n'
  if (fs.existsSync(indexPath)) {
    const cur = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n')
    if (cur.trim() === body.trim()) return
  }
  console.log('write barrel:', `${domain}/index.ts`)
  if (!dryRun) fs.writeFileSync(indexPath, body, 'utf8')
}

function runBatch(name) {
  const modules = unique(C5_BATCHES[name])
  console.log(`\n=== C5 batch=${name} modules=${modules.length}${dryRun ? ' (dry-run)' : ''} ===`)
  const moved = renameModules(modules, name)
  const fixed = fixMovedFileRelativeImports(modules, name)
  const changed = migrateImports(modules, name)
  writeIndexBarrel(name, modules.filter((m) => fs.existsSync(path.join(coreDir, name, `${m}.ts`))))
  console.log(`batch ${name}: moved=${moved} relativeFixed=${fixed} importFilesChanged=${changed}`)
  return { moved, modules }
}

function parseBatchList() {
  const batchesIdx = args.indexOf('--batches')
  if (batchesIdx >= 0) {
    return args[batchesIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (batchName) return [batchName]
  return []
}

const batchList = parseBatchList()

if (!batchList.length || batchList.some((b) => !C5_BATCHES[b])) {
  console.error(
    'Usage: node scripts/migrate-c5-rename-core.mjs --batch <name> [--dry-run] [--delete-shims]'
  )
  console.error(
    '       node scripts/migrate-c5-rename-core.mjs --batches output,db,agent [--dry-run] [--delete-shims]'
  )
  console.error('Batches:', Object.keys(C5_BATCHES).join(', '))
  process.exit(1)
}

if (deleteShims) {
  let total = 0
  for (const b of batchList) {
    total += deleteBatchShims(unique(C5_BATCHES[b]))
  }
  console.log(`Deleted ${total} shims across ${batchList.length} batch(es)`)
  process.exit(0)
}

const allModules = []
for (const b of batchList) {
  const { moved, modules } = runBatch(b)
  if (moved) allModules.push(...modules)
}
console.log(`\nDone ${batchList.length} batch(es)${dryRun ? ' (dry-run)' : ''}`)
