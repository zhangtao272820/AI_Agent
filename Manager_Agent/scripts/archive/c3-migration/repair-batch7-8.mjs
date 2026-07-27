/** Repair batch-7/8 split artifacts */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content.endsWith('\n') ? content : content + '\n', 'utf8')
}

function stripNestedExport(src, runName) {
  let s = read(src)
  s = s.replace(new RegExp(`export async function run\\w+Body\\([^)]+\\) \\{\\s*export function ${runName}[^{]*\\{`, 'm'), (m) => {
    const head = m.match(/export async function (\w+)\(([^)]+)\)/)
    return `export async function ${head[1]}(${head[2]}) {`
  })
  write(src, s)
}

stripNestedExport('server/graph/nodes/plan/planNodeBody.ts', 'createPlanNodeRun')
stripNestedExport('server/graph/nodes/multi/multiNodeBody.ts', 'createMultiNodeRun')
stripNestedExport('server/graph/nodes/router/routerNodeBody.ts', 'createRouterNodeRun')

// router: no helpers param
{
  let s = read('server/graph/nodes/router/routerNodeBody.ts')
  s = s.replace('runRouterNodeBody(state: any, deps: any, helpers: any)', 'runRouterNodeBody(state: any, deps: CreateRouterNodeDeps)')
  write('server/graph/nodes/router/routerNodeBody.ts', s)
}

// plan/multi run shims — dedupe imports
for (const f of ['server/graph/nodes/plan/planNodeRun.ts', 'server/graph/nodes/multi/multiNodeRun.ts', 'server/graph/nodes/router/routerNodeRun.ts']) {
  const lines = read(f).split(/\r?\n/)
  const seen = new Set()
  const out = []
  for (const line of lines) {
    if (line.startsWith('import type { Create') || line.startsWith('import { run')) {
      if (seen.has(line)) continue
      seen.add(line)
    }
    out.push(line)
  }
  write(f, out.join('\n'))
}

// unifiedLearning + layeredMemory import paths
for (const sub of ['unifiedLearning/record.ts', 'unifiedLearning/indexers.ts', 'layeredMemory/record.ts', 'layeredMemory/recall.ts']) {
  let s = read(`server/graph/core/${sub}`)
  s = s.replaceAll("from './managerGraph.", "from '../managerGraph.")
  write(`server/graph/core/${sub}`, s)
}

// layeredMemory/index barrel
write(
  'server/graph/core/layeredMemory/index.ts',
  `export * from './record'
export * from './recall'
`
)
write(
  'server/graph/core/unifiedLearning/index.ts',
  `export * from './record'
export * from './indexers'
`
)

console.log('repair-batch7-8: body + learning paths fixed')
