/**
 * C7-2: move scripts/smoke-*.ts → scripts/smoke/{category}/
 * Updates relative imports and package.json smoke:* paths.
 *
 * Usage:
 *   node scripts/migrate-c7-smoke-dirs.mjs --dry-run
 *   node scripts/migrate-c7-smoke-dirs.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const root = process.cwd()
const scriptsDir = path.join(root, 'scripts')

/** smoke file basename → subdir under scripts/smoke/ */
const C7_SMOKE_MAP = {
  'smoke-batch-a.ts': 'batch',
  'smoke-batch-b.ts': 'batch',
  'smoke-batch-c.ts': 'batch',
  'smoke-batch-d.ts': 'batch',
  'smoke-batch-e.ts': 'batch',
  'smoke-route-admin-retain.ts': 'route',
  'smoke-route-json-parse.ts': 'route',
  'smoke-route-matrix.ts': 'route',
  'smoke-route-orchestration.ts': 'route',
  'smoke-route-understand-align.ts': 'route',
  'smoke-routing-planner-fix.ts': 'route',
  'smoke-turn-scope-routing.ts': 'route',
  'smoke-user-intent-supremacy.ts': 'route',
  'smoke-intent-merged.ts': 'route',
  'smoke-route-convergence-gate.ts': 'route',
  'smoke-route-plan-card.ts': 'route',
  'smoke-route-matrix-ws.ts': 'route',
  'smoke-route-matrix-orchestrate.ts': 'route',
  'smoke-real-domain-route.ts': 'route',
  'smoke-collab-route.ts': 'route',
  'smoke-weather-admin-route.ts': 'route',
  'smoke-plan-orchestrator.ts': 'plan',
  'smoke-plan-scheduler.ts': 'plan',
  'smoke-plan-coverage.ts': 'plan',
  'smoke-plan-shortcuts.ts': 'plan',
  'smoke-clause-plan-binding.ts': 'plan',
  'smoke-clarify-replan.ts': 'plan',
  'smoke-step-query-scope.ts': 'plan',
  'smoke-pro-understand.ts': 'plan',
  'smoke-clause-decompose-golden.ts': 'plan',
  'smoke-db-multi-question.ts': 'db',
  'smoke-db-prefetch-reuse.ts': 'db',
  'smoke-db-prefetch-align.ts': 'db',
  'smoke-admin-manager-protocol.ts': 'db',
  'smoke-rag-prefetch-align.ts': 'rag',
  'smoke-rag-query-resolve.ts': 'rag',
  'smoke-intent-rag-domain.ts': 'rag',
  'smoke-intent-rag-recall.ts': 'rag',
  'smoke-gui-upgrade.ts': 'gui',
  'smoke-gui-route-whitelist.ts': 'gui',
  'smoke-gui-vision-ui-fixes.ts': 'gui',
  'smoke-chat-web-ui.ts': 'gui',
  'smoke-orchestrator-pipeline.ts': 'orchestrate',
  'smoke-orchestration-narrative.ts': 'orchestrate',
  'smoke-unified-orchestrator.ts': 'orchestrate',
  'smoke-call-fusion.ts': 'orchestrate',
  'smoke-critic-evidence.ts': 'orchestrate',
  'smoke-evolution-upgrades.ts': 'evolution',
  'smoke-skill-cleanup.ts': 'evolution',
  'smoke-synth-shape-policy.ts': 'evolution',
  'smoke-skill-draft.ts': 'evolution',
  'smoke-searxng.ts': 'search',
  'smoke-web-search-open.ts': 'search',
  'smoke-web-search-upgrade.ts': 'search',
  'smoke-manager-graph.ts': 'gate',
  'smoke-env-modes.ts': 'gate',
  'smoke-p0-upgrades.ts': 'gate',
  'smoke-p1-upgrades.ts': 'gate',
  'smoke-p2-upgrades.ts': 'gate',
  'smoke-p3-upgrades.ts': 'gate',
  'smoke-golden-paths.ts': 'gate',
  'smoke-code-authority-chart.ts': 'gate',
  'smoke-internal-agents.ts': 'gate',
  'smoke-phase2-upgrades.ts': 'gate',
  'smoke-memory-coordination.ts': 'gate',
  'smoke-context-clarify.ts': 'gate',
  'smoke-turn-scope-protocol.ts': 'gate',
  'smoke-clean-speed.ts': 'misc',
  'smoke-code-authority-scheduler.ts': 'misc',
  'smoke-crawler-synth-context.ts': 'misc',
  'smoke-deep-seek-reply.ts': 'misc',
  'smoke-panels-echarts.ts': 'misc',
  'smoke-token-observability.ts': 'misc',
  'smoke-turn-isolation.ts': 'misc',
  'smoke-mode-isolation.ts': 'misc'
}

const EXTRA_MOVES = [{ file: 'route-matrix-cases.ts', subdir: 'route' }]

function fixSmokeFileContent(raw, subdir) {
  let next = raw.replace(/\r\n/g, '\n')
  // imports: scripts/ → scripts/smoke/{subdir}/
  next = next.replace(/from\s+(['"])\.\.\/\.\.\/shared\//g, "from $1../../../../shared/")
  next = next.replace(/from\s+(['"])\.\.\/shared\//g, "from $1../../../shared/")
  next = next.replace(/from\s+(['"])\.\.\/server\//g, "from $1../../../server/")
  next = next.replace(/await import\(\s*(['"])\.\.\/shared\//g, 'await import($1../../../shared/')
  next = next.replace(/await import\(\s*(['"])\.\.\/server\//g, 'await import($1../../../server/')

  // path joins (Manager_Agent root — scripts/smoke/{cat}/ → ../../..)
  next = next.replace(/path\.resolve\(__dirname,\s*'\.\.'\)/g, "path.resolve(__dirname, '../../..')")
  next = next.replace(/path\.join\(__dirname,\s*'\.\.'\)/g, "path.join(__dirname, '../../..')")
  next = next.replace(/path\.join\(__dirname,\s*'\.\.',\s*'eval/g, "path.join(__dirname, '../../..', 'eval")
  next = next.replace(/join\(__dirname,\s*'\.\.',\s*'eval/g, "join(__dirname, '../../..', 'eval")
  next = next.replace(/join\(__dirname,\s*'\.\.',\s*'\.env/g, "join(__dirname, '../../..', '.env")

  // repo root (Agent/) — was ../.. from scripts/
  next = next.replace(/path\.resolve\(__dirname,\s*'\.\.\/\.\.'\)/g, "path.resolve(__dirname, '../../../..')")

  // dynamic pathToFileURL joins
  next = next.replace(/join\(__dirname,\s*'\.\.\/\.\.\/shared\//g, "join(__dirname, '../../../../shared/")
  next = next.replace(/join\(__dirname,\s*'\.\.\/server\//g, "join(__dirname, '../../../server/")

  // phase2 spawns scripts in other smoke subdirs
  if (subdir === 'gate' && next.includes('smoke-step-query-scope.ts')) {
    next = next.replace(
      `const childScripts = [
  'smoke-step-query-scope.ts',
  'smoke-mode-isolation.ts',
  'smoke-clarify-replan.ts',
  'smoke-real-domain-route.ts'
]
for (const script of childScripts) {
  const r = spawnSync('npx', ['--yes', 'tsx', path.join(__dirname, script)], {`,
      `const childScripts = [
  '../plan/smoke-step-query-scope.ts',
  '../misc/smoke-mode-isolation.ts',
  '../plan/smoke-clarify-replan.ts',
  '../route/smoke-real-domain-route.ts'
]
for (const script of childScripts) {
  const r = spawnSync('npx', ['--yes', 'tsx', path.join(__dirname, script)], {`
    )
  }

  return next
}

function moveFile(name, subdir) {
  const src = path.join(scriptsDir, name)
  const destDir = path.join(scriptsDir, 'smoke', subdir)
  const dest = path.join(destDir, name)
  if (!fs.existsSync(src)) {
    console.warn('skip missing:', name)
    return false
  }
  console.log('move:', `${name} → smoke/${subdir}/`)
  if (!dryRun) {
    fs.mkdirSync(destDir, { recursive: true })
    const raw = fs.readFileSync(src, 'utf8')
    const fixed = fixSmokeFileContent(raw, subdir)
    fs.writeFileSync(dest, raw.includes('\r\n') ? fixed.replace(/\n/g, '\r\n') : fixed, 'utf8')
    fs.unlinkSync(src)
  }
  return true
}

function updatePackageJson() {
  const pkgPath = path.join(root, 'package.json')
  const raw = fs.readFileSync(pkgPath, 'utf8')
  let next = raw
  for (const [name, subdir] of Object.entries(C7_SMOKE_MAP)) {
    const oldPath = `scripts/${name}`
    const newPath = `scripts/smoke/${subdir}/${name}`
    next = next.split(oldPath).join(newPath)
  }
  if (next !== raw) {
    console.log('updated package.json smoke paths')
    if (!dryRun) fs.writeFileSync(pkgPath, next, 'utf8')
  }
}

let moved = 0
for (const [name, subdir] of Object.entries(C7_SMOKE_MAP)) {
  if (moveFile(name, subdir)) moved++
}
for (const { file, subdir } of EXTRA_MOVES) {
  if (moveFile(file, subdir)) moved++
}
updatePackageJson()
console.log(`Done. moved=${moved}${dryRun ? ' (dry-run)' : ''}`)
