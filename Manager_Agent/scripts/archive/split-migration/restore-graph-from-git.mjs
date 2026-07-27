/**
 * Restore server/graph/** from git (pre-reorg server/utils sources), re-apply B2 import rewrites.
 * Fixes UTF-8 corruption from PowerShell bulk replace.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const root = process.cwd()
const graphRoot = path.join(root, 'server/graph')
const utilsRoot = path.join(root, 'server/utils')
const GIT_REF = process.env.GRAPH_RESTORE_REF || 'ae854ab'

const STATE_FILES = new Set([
  'managerGraph.state.ts',
  'managerGraph.graph.ts',
  'managerGraph.invokeConfig.ts',
  'managerGraph.ts'
])

const ORCHESTRATE_RE =
  /Orchestrat|unifiedRouting|unifiedOrchestrat|chatOrchestrat|professionalOrchestrat|taskOrchestrator|orchestratorPipeline|orchestratorJudge|orchestratorInvariants/i

function categorize(basename) {
  if (STATE_FILES.has(basename)) return 'state'
  if (basename.endsWith('Llm.ts')) return 'llm'
  if (basename.endsWith('Node.ts') || basename.endsWith('Nodes.ts')) return 'nodes'
  if (ORCHESTRATE_RE.test(basename)) return 'orchestrate'
  return 'core'
}

function gitShow(gitPath) {
  try {
    return execSync(`git show ${GIT_REF}:${gitPath}`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
  } catch {
    return null
  }
}

function listGraphBasenames() {
  const out = new Set()
  for (const dir of ['state', 'llm', 'nodes', 'orchestrate', 'core']) {
    const d = path.join(graphRoot, dir)
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith('.ts')) out.add(f)
    }
  }
  return [...out].sort()
}

const basenames = listGraphBasenames()
const fileToDir = new Map(basenames.map((f) => [f, categorize(f)]))

function relImport(fromDir, targetFile) {
  const targetDir = fileToDir.get(targetFile)
  const from = path.join(graphRoot, fromDir)
  const to = path.join(graphRoot, targetDir, targetFile)
  let rel = path.relative(from, to).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel.replace(/\.ts$/, '')
}

function rewriteGraphImports(content, fromDir) {
  let next = content.replace(
    /from\s+['"](\.\/)?(managerGraph\.[^'"]+)['"]/g,
    (full, _dot, spec) => {
      const targetFile = spec.endsWith('.ts') ? spec : `${spec}.ts`
      if (!fileToDir.has(targetFile)) return full
      const rel = relImport(fromDir, targetFile)
      return `from '${rel}'`
    }
  )
  // utils modules (non-managerGraph) live under server/utils
  next = next.replace(/from\s+['"](\.\/[^'"]+)['"]/g, (full, spec) => {
    if (spec.startsWith('./managerGraph')) return full
    const base = spec.replace(/^\.\//, '')
    const candidates = [
      path.join(utilsRoot, `${base}.ts`),
      path.join(utilsRoot, base, 'index.ts'),
      path.join(utilsRoot, base)
    ]
    if (candidates.some((p) => fs.existsSync(p))) {
      return `from '../../utils/${base}'`
    }
    return full
  })
  // repo shared/ (Manager_Agent/shared) — one level up from server/
  next = next.replace(/from\s+['"](\.\.\/){2}shared\//g, "from '../../../shared/")
  // utils modules (dynamic import)
  next = next.replace(/import\(['"](\.\/[^'"]+)['"]\)/g, (full, spec) => {
    if (spec.startsWith('./managerGraph')) return full
    const base = spec.replace(/^\.\//, '')
    const candidates = [
      path.join(utilsRoot, `${base}.ts`),
      path.join(utilsRoot, base, 'index.ts'),
      path.join(utilsRoot, base)
    ]
    if (candidates.some((p) => fs.existsSync(p))) {
      return `import('../../utils/${base}')`
    }
    return full
  })
  return next
}

let restored = 0
let missing = 0

for (const basename of basenames) {
  const dir = fileToDir.get(basename)
  const gitPath = `Manager_Agent/server/utils/${basename}`
  const raw = gitShow(gitPath)
  if (!raw) {
    console.warn(`missing in git: ${gitPath}`)
    missing++
    continue
  }
  const content = rewriteGraphImports(raw, dir)
  const dest = path.join(graphRoot, dir, basename)
  fs.writeFileSync(dest, content, 'utf8')
  restored++
}

console.log(`restore-graph-from-git: restored ${restored} files (${missing} missing) from ${GIT_REF}`)
