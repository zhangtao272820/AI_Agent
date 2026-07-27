/**
 * Fix cross-directory managerGraph imports after B2 reorg (static + dynamic + type imports).
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const graphRoot = path.join(root, 'server/graph')

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

const fileToDir = new Map()
for (const dir of ['state', 'llm', 'nodes', 'orchestrate', 'core']) {
  const d = path.join(graphRoot, dir)
  if (!fs.existsSync(d)) continue
  for (const f of fs.readdirSync(d)) {
    if (f.endsWith('.ts')) fileToDir.set(f, dir)
  }
}

function relImport(fromDir, targetFile) {
  const targetDir = fileToDir.get(targetFile)
  if (!targetDir) return null
  const from = path.join(graphRoot, fromDir)
  const to = path.join(graphRoot, targetDir, targetFile)
  let rel = path.relative(from, to).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel.replace(/\.ts$/, '')
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.name.endsWith('.ts')) out.push(p)
  }
  return out
}

function rewrite(content, fromDir) {
  return content.replace(
    /(['"])(\.\/)?(managerGraph(?:\.[A-Za-z0-9_.]+)?)\1/g,
    (full, quote, _dot, spec) => {
      const targetFile = spec === 'managerGraph' ? 'managerGraph.ts' : spec.endsWith('.ts') ? spec : `${spec}.ts`
      if (!fileToDir.has(targetFile)) return full
      const rel = relImport(fromDir, targetFile)
      if (!rel) return full
      const current = `./${spec.replace(/\.ts$/, '')}`
      if (rel === current || rel === `./${spec}`) return full
      return `${quote}${rel}${quote}`
    }
  )
}

let patched = 0
for (const file of walk(graphRoot)) {
  const basename = path.basename(file)
  const fromDir = fileToDir.get(basename)
  if (!fromDir) continue
  const raw = fs.readFileSync(file, 'utf8')
  const next = rewrite(raw, fromDir)
  if (next !== raw) {
    fs.writeFileSync(file, next, 'utf8')
    patched++
  }
}

console.log(`fix-graph-cross-imports: patched ${patched} files`)
