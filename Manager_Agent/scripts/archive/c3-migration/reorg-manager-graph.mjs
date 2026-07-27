/**
 * B2: Move managerGraph* modules under server/graph/ with re-export shims at old paths.
 * Behavior-neutral: only paths change; shims preserve existing imports.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const utilsDir = path.join(root, 'server/utils')
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

const files = fs
  .readdirSync(utilsDir)
  .filter((f) => f.startsWith('managerGraph') && f.endsWith('.ts'))
  .sort()

const fileToDir = new Map()
for (const f of files) {
  fileToDir.set(f, categorize(f))
}

for (const dir of ['state', 'llm', 'nodes', 'orchestrate', 'core']) {
  fs.mkdirSync(path.join(graphRoot, dir), { recursive: true })
}

function relImport(fromDir, targetFile) {
  const targetDir = fileToDir.get(targetFile)
  if (!targetDir) return `./${targetFile.replace(/\.ts$/, '')}`
  const from = path.join(graphRoot, fromDir)
  const to = path.join(graphRoot, targetDir, targetFile)
  let rel = path.relative(from, to).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel.replace(/\.ts$/, '')
}

function rewriteImports(content, fromDir) {
  return content.replace(
    /from\s+['"](\.\/)?(managerGraph\.[^'"]+)['"]/g,
    (full, _dot, spec) => {
      const targetFile = spec.endsWith('.ts') ? spec : `${spec}.ts`
      if (!fileToDir.has(targetFile)) return full
      const rel = relImport(fromDir, targetFile)
      return `from '${rel}'`
    }
  )
}

let moved = 0
for (const basename of files) {
  const dir = fileToDir.get(basename)
  const src = path.join(utilsDir, basename)
  const dest = path.join(graphRoot, dir, basename)
  if (fs.existsSync(dest)) fs.unlinkSync(dest)
  let content = fs.readFileSync(src, 'utf8')
  content = rewriteImports(content, dir)
  fs.writeFileSync(dest, content)
  fs.unlinkSync(src)
  const shim = `/** @deprecated import from \`server/graph/${dir}/${basename}\` — shim for B2 reorg */\nexport * from '../graph/${dir}/${basename.replace(/\.ts$/, '')}'\n`
  fs.writeFileSync(path.join(utilsDir, basename), shim)
  moved++
}

const readme = `# server/graph — Manager LangGraph modules (B2)

Auto-reorganized from \`server/utils/managerGraph*.ts\`. Old paths re-export shims remain for compatibility.

| Directory | Role | Files |
|-----------|------|-------|
| \`state/\` | Graph factory, invoke config, typed state | ${files.filter((f) => fileToDir.get(f) === 'state').length} |
| \`nodes/\` | LangGraph node implementations | ${files.filter((f) => fileToDir.get(f) === 'nodes').length} |
| \`llm/\` | LLM prompt/schema helpers | ${files.filter((f) => fileToDir.get(f) === 'llm').length} |
| \`orchestrate/\` | Unified/chat/pro orchestration | ${files.filter((f) => fileToDir.get(f) === 'orchestrate').length} |
| \`core/\` | Shared graph utilities | ${files.filter((f) => fileToDir.get(f) === 'core').length} |

Total moved: ${moved} modules.
`
fs.writeFileSync(path.join(graphRoot, 'README.md'), readme)
console.log(`reorg-manager-graph: moved ${moved} files`)
