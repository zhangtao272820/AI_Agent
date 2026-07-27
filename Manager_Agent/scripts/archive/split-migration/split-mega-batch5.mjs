/**
 * B5 batch-5: synthNode body split + stepIsolation → core/stepIsolation/
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

// synthNode: body lines 99-end (skip export function line 98)
{
  const src = 'server/graph/nodes/final/synthNode.ts'
  const lines = readLines(src)
  const importEnd = lines.findIndex((l) => l.startsWith('export function buildSynthNode'))
  const importBlock = lines.slice(0, importEnd).join('\n')
  const body = sliceLines(lines, 99)
  write(
    'server/graph/nodes/final/synthNodeRun.ts',
    `${importBlock}
import type { CreateFinalNodesDeps } from './types'

export function buildSynthNodeRun(deps: CreateFinalNodesDeps) {
${body.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}
}
`
  )
  write(
    'server/graph/nodes/final/synthNode.ts',
    `import type { CreateFinalNodesDeps } from './types'
import { buildSynthNodeRun } from './synthNodeRun'

export function buildSynthNode(deps: CreateFinalNodesDeps) {
  return buildSynthNodeRun(deps)
}
`
  )
  console.log('split: synthNode → synthNodeRun.ts')
}

// stepIsolation: sanitize (1-459) + exec (460-end)
{
  const src = 'server/graph/core/managerGraph.stepIsolation.ts'
  const lines = readLines(src)
  const sanitizeBlock = sliceLines(lines, 1, 459)
  const execBlock = sliceLines(lines, 460)

  write(
    'server/graph/core/stepIsolation/sanitize.ts',
    `${sanitizeBlock}
`
  )

  write(
    'server/graph/core/stepIsolation/exec.ts',
    `import type { Step } from '../../../utils/taskPlan'
import { ACTION_EXEC_AGENTS, DATA_SOURCE_AGENTS } from './sanitize'
import {
  adminStepNeedsUpstreamData,
  buildAdminStepQuery,
  extractAdminSubtaskText,
  sanitizeStepQueryStructured
} from './sanitize'

${execBlock}
`
  )

  write(
    'server/graph/core/stepIsolation/index.ts',
    `export * from './sanitize'
export * from './exec'
`
  )

  write(
    'server/graph/core/managerGraph.stepIsolation.ts',
    `/** @deprecated import from \`server/graph/core/stepIsolation/\` — B5 batch-5 split */
export * from './stepIsolation/index'
`
  )

  console.log('split: stepIsolation → core/stepIsolation/{sanitize,exec,index}.ts')
}

console.log('split-mega-batch5: done')
