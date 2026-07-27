/**
 * B5 batch-4: multi + router + finalize body splits
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readLines(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/)
}

function write(rel, content) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content.endsWith('\n') ? content : content + '\n', 'utf8')
}

function sliceLines(lines, start1, end1) {
  return lines.slice(start1 - 1, end1).join('\n')
}

function splitNodeBody({ src, outRun, outCreate, exportName, runExportName, importEnd, bodyStart, bodyEnd, extraIndex }) {
  const lines = readLines(src)
  const importBlock = lines.slice(0, importEnd).join('\n')
  const body = sliceLines(lines, bodyStart, bodyEnd)

  write(
    outRun,
    `${importBlock}
import type { ${exportName.replace('create', 'Create').replace('build', 'Build')}NodeDeps } from './types'

export function ${runExportName}(deps: ${exportName.replace('create', 'Create').replace('build', 'Build')}NodeDeps) {
${body.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}
}
`
  )

  write(
    outCreate,
    `${importBlock}
import { ${runExportName} } from './${path.basename(outRun, '.ts')}'
import type { ${exportName.replace('create', 'Create').replace('build', 'Build')}NodeDeps } from './types'

export function ${exportName}(deps: ${exportName.replace('create', 'Create').replace('build', 'Build')}NodeDeps) {
  return ${runExportName}(deps)
}
`
  )

  if (extraIndex) fs.writeFileSync(path.join(root, extraIndex), fs.readFileSync(path.join(root, extraIndex), 'utf8'), 'utf8')
  console.log(`split: ${src} → ${path.basename(outRun)}`)
}

// multi: lines 63-1224 body inside createMultiNode
{
  const src = 'server/graph/nodes/multi/createMultiNode.ts'
  const lines = readLines(src)
  const importBlock = lines.slice(0, 61).join('\n')
  const body = sliceLines(lines, 63, 1224)
  write(
    'server/graph/nodes/multi/multiNodeRun.ts',
    `${importBlock}
import type { CreateMultiNodeDeps } from './types'

export function createMultiNodeRun(deps: CreateMultiNodeDeps) {
${body.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}
}
`
  )
  write(
    'server/graph/nodes/multi/createMultiNode.ts',
    `${importBlock}
import { createMultiNodeRun } from './multiNodeRun'
import type { CreateMultiNodeDeps } from './types'

export function createMultiNode(deps: CreateMultiNodeDeps) {
  return createMultiNodeRun(deps)
}
`
  )
  write(
    'server/graph/nodes/multi/index.ts',
    `export { createMultiNode, type CreateMultiNodeDeps } from './createMultiNode'\n`
  )
  console.log('split: multi → multiNodeRun.ts')
}

// router: lines 92-1144
{
  const src = 'server/graph/nodes/router/createRouterNode.ts'
  const lines = readLines(src)
  const importBlock = lines.slice(0, 90).join('\n')
  const body = sliceLines(lines, 92, 1144)
  write(
    'server/graph/nodes/router/routerNodeRun.ts',
    `${importBlock}
import { ROUTER_PLAYBOOK_FALLBACK, deriveAllowedAgentsFromRoute, finalizeAllowedAgents } from './helpers'
import type { CreateRouterNodeDeps } from './types'

export function createRouterNodeRun(deps: CreateRouterNodeDeps) {
${body.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}
}
`
  )
  write(
    'server/graph/nodes/router/createRouterNode.ts',
    `${importBlock}
import { createRouterNodeRun } from './routerNodeRun'
import type { CreateRouterNodeDeps } from './types'

export function createRouterNode(deps: CreateRouterNodeDeps) {
  return createRouterNodeRun(deps)
}
`
  )
  console.log('split: router → routerNodeRun.ts')
}

// finalize: buildFinalizeNode lines 98-end
{
  const src = 'server/graph/nodes/final/finalizeNode.ts'
  const lines = readLines(src)
  const importEnd = lines.findIndex((l) => l.startsWith('export function buildFinalizeNode'))
  const importBlock = lines.slice(0, importEnd).join('\n')
  const body = sliceLines(lines, 98)
  write(
    'server/graph/nodes/final/finalizeNodeRun.ts',
    `${importBlock}
import type { CreateFinalNodesDeps } from './types'

export function buildFinalizeNodeRun(deps: CreateFinalNodesDeps) {
${body.split('\n').slice(1).map((l) => (l ? `  ${l}` : l)).join('\n')}
}
`
  )
  write(
    'server/graph/nodes/final/finalizeNode.ts',
    `${importBlock}
import { buildFinalizeNodeRun } from './finalizeNodeRun'
import type { CreateFinalNodesDeps } from './types'

export function buildFinalizeNode(deps: CreateFinalNodesDeps) {
  return buildFinalizeNodeRun(deps)
}
`
  )
  console.log('split: finalize → finalizeNodeRun.ts')
}

console.log('split-mega-batch4: done')
