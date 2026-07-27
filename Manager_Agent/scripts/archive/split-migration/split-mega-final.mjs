/**
 * B5 final: batch nodes + taskOrchestrator + proPuStack + metaNodes
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
  fs.writeFileSync(p, (content.endsWith('\n') ? content : content + '\n'), 'utf8')
}

function sliceLines(lines, start, end) {
  return lines.slice(start - 1, end).join('\n')
}

function shimExportAll(rel, subdir) {
  write(rel, `/** B5 split — re-export shim */\nexport * from './${subdir}'\n`)
}

function splitBatchNode({ src, dir, exportName, depsType }) {
  const srcPath = path.join(root, src)
  if (!fs.existsSync(srcPath) || fs.readFileSync(srcPath, 'utf8').includes('re-export shim')) {
    console.log('skip', src)
    return
  }
  const lines = readLines(src)
  const depsLine = lines.findIndex((l) => new RegExp(`^(export )?type ${depsType}\\b`).test(l))
  const fnLine = lines.findIndex((l) => l.startsWith(`export function ${exportName}`))
  if (depsLine < 0 || fnLine < 0) throw new Error(`${src}: missing ${depsType}/${exportName}`)

  let typeStart = depsLine
  while (typeStart > 0) {
    let prevIdx = typeStart - 1
    while (prevIdx >= 0 && lines[prevIdx].trim() === '') prevIdx--
    if (prevIdx < 0) break
    if (lines[prevIdx].trimEnd() === '}') {
      let j = prevIdx - 1
      while (j >= 0 && !/^type \w+/.test(lines[j].trimEnd())) j--
      if (j >= 0 && /^type \w+/.test(lines[j].trimEnd())) {
        typeStart = j
        continue
      }
    }
    break
  }

  const importBlock = sliceLines(lines, 1, typeStart)
  const typesBlock = sliceLines(lines, typeStart + 1, fnLine).replace(/^type (\w+)/gm, 'export type $1')
  const createFile = `${exportName}.ts`
  const sub = path.basename(dir)

  write(`${dir}/types.ts`, `${typesBlock}\n`)
  write(`${dir}/${createFile}`, `${importBlock}\nimport type { ${depsType} } from './types'\n\n${sliceLines(lines, fnLine, lines.length)}\n`)
  write(`${dir}/index.ts`, `export { ${exportName}, type ${depsType} } from './${createFile.replace(/\.ts$/, '')}'\n`)
  write(src, `/** B5: ${sub} node split — re-export shim */\nexport { ${exportName}, type ${depsType} } from './${sub}'\n`)
  console.log('batch:', src, '→', dir)
}

const BATCH_NODES = [
  { src: 'server/graph/nodes/managerGraph.schedulerNode.ts', dir: 'server/graph/nodes/scheduler', exportName: 'createSchedulerNode', depsType: 'CreateSchedulerNodeDeps' },
  { src: 'server/graph/nodes/managerGraph.optimizerNode.ts', dir: 'server/graph/nodes/optimizer', exportName: 'createOptimizerNode', depsType: 'CreateOptimizerNodeDeps' },
  { src: 'server/graph/nodes/managerGraph.evaluatorNode.ts', dir: 'server/graph/nodes/evaluator', exportName: 'createEvaluatorNode', depsType: 'CreateEvaluatorNodeDeps' },
  { src: 'server/graph/nodes/managerGraph.modeNode.ts', dir: 'server/graph/nodes/mode', exportName: 'createExecutionModeNode', depsType: 'CreateExecutionModeNodeDeps' },
  { src: 'server/graph/nodes/managerGraph.monitorNode.ts', dir: 'server/graph/nodes/monitor', exportName: 'createMonitorNode', depsType: 'CreateMonitorNodeDeps' },
  { src: 'server/graph/nodes/managerGraph.voteAggregatorNode.ts', dir: 'server/graph/nodes/voteAggregator', exportName: 'createVoteAggregatorNode', depsType: 'CreateVoteAggregatorNodeDeps' },
  { src: 'server/graph/nodes/managerGraph.securityNode.ts', dir: 'server/graph/nodes/security', exportName: 'createSecurityNode', depsType: 'CreateSecurityNodeDeps' },
  { src: 'server/graph/nodes/managerGraph.turnScopeNode.ts', dir: 'server/graph/nodes/turnScope', exportName: 'createTurnScopeNode', depsType: 'CreateTurnScopeNodeDeps' },
  { src: 'server/graph/nodes/managerGraph.resourceNode.ts', dir: 'server/graph/nodes/resource', exportName: 'createResourceNode', depsType: 'CreateResourceNodeDeps' },
  { src: 'server/graph/nodes/managerGraph.planPreviewNode.ts', dir: 'server/graph/nodes/planPreview', exportName: 'createPlanPreviewNode', depsType: 'PlanPreviewNodeDeps' }
]

for (const n of BATCH_NODES) splitBatchNode(n)

// metaNodes
{
  const src = 'server/graph/nodes/managerGraph.metaNodes.ts'
  if (fs.existsSync(path.join(root, src)) && !fs.readFileSync(path.join(root, src), 'utf8').includes('re-export shim')) {
    const lines = readLines(src)
    const metacogType = lines.findIndex((l) => l.startsWith('export type CreateMetacogNodeDeps'))
    const metacogFn = lines.findIndex((l) => l.startsWith('export function createMetacogNode'))
    const clarifyType = lines.findIndex((l) => l.startsWith('export type CreateClarifyNodeDeps'))
    const clarifyFn = lines.findIndex((l) => l.startsWith('export function createClarifyNode'))
    const imports = sliceLines(lines, 1, metacogType)
    write('server/graph/nodes/meta/types.ts', `${sliceLines(lines, metacogType, clarifyType)}\n`)
    write('server/graph/nodes/meta/createMetacogNode.ts', `${imports}\nimport type { CreateMetacogNodeDeps } from './types'\n\n${sliceLines(lines, metacogFn, clarifyType)}\n`)
    write('server/graph/nodes/meta/createClarifyNode.ts', `${imports}\nimport type { CreateClarifyNodeDeps } from './types'\n\n${sliceLines(lines, clarifyFn, lines.length)}\n`)
    write(
      'server/graph/nodes/meta/index.ts',
      `export { createMetacogNode, type CreateMetacogNodeDeps } from './createMetacogNode'\nexport { createClarifyNode, type CreateClarifyNodeDeps } from './createClarifyNode'\n`
    )
    write(
      src,
      `/** B5: meta nodes split — re-export shim */\nexport { createMetacogNode, type CreateMetacogNodeDeps, createClarifyNode, type CreateClarifyNodeDeps } from './meta'\n`
    )
    console.log('metaNodes → meta/')
  }
}

// taskOrchestrator
{
  const src = 'server/graph/llm/managerGraph.taskOrchestratorLlm.ts'
  if (fs.existsSync(path.join(root, src)) && !fs.readFileSync(path.join(root, src), 'utf8').includes('re-export shim')) {
    const lines = readLines(src)
    const header = sliceLines(lines, 7, 35).replace(/^export \{ isUnifiedOrchestratorEnabled.*\n?/m, '')
    write('server/graph/llm/taskOrchestrator/schemas.ts', `${header}\n\n${sliceLines(lines, 37, 168)}\n`)
    write(
      'server/graph/llm/taskOrchestrator/parseBundle.ts',
      `${header}
import {
  TaskOrchestratorSchema,
  type TaskOrchestratorRaw,
  type TaskOrchestratorBundle,
  type OrchestratorParseFailure
} from './schemas'

${sliceLines(lines, 170, 748)}
`
    )
    write(
      'server/graph/llm/taskOrchestrator/resolve.ts',
      `${header}
import type { OrchestratorParseFailure } from './schemas'
import { bundleFromOrchestratorRaw, parseCompactOrchestratorJson, parseOrchestratorJson } from './parseBundle'
import { isOrchestratorCompactFirst } from '../../orchestrate/managerGraph.orchestratorHeuristic'

${sliceLines(lines, 750, 926)}
`
    )
    write(
      'server/graph/llm/taskOrchestrator/index.ts',
      `export * from './schemas'
export * from './parseBundle'
export * from './resolve'
export { isUnifiedOrchestratorEnabled, unifiedRoutingEnvEnabled } from '../../orchestrate/managerGraph.unifiedRouting'
`
    )
    shimExportAll(src, 'taskOrchestrator')
    console.log('taskOrchestratorLlm → taskOrchestrator/')
  }
}

// proPuStack — schemas + stackImpl
{
  const src = 'server/graph/core/managerGraph.proPuStack.ts'
  if (fs.existsSync(path.join(root, src)) && !fs.readFileSync(path.join(root, src), 'utf8').includes('re-export shim')) {
    const lines = readLines(src)
    const header = sliceLines(lines, 6, 24)
    write('server/graph/core/proPuStack/schemas.ts', `${header}\n\n${sliceLines(lines, 25, 128)}\n\nexport { TaskShapeSchema, DataPlaneSchema, ActionPlaneSchema, AmbiguitySchema, ProPuStackUnifiedSchema }\n`)
    write(
      'server/graph/core/proPuStack/stackImpl.ts',
      `${header}
import {
  PreservedConstraintsSchema,
  InferredDataSourceSchema,
  StepDispatchDraftSchema,
  TaskShapeSchema,
  DataPlaneSchema,
  ActionPlaneSchema,
  AmbiguitySchema,
  ProPuStackUnifiedSchema,
  type PreservedConstraints,
  type InferredDataSource,
  type StepDispatchDraft
} from './schemas'

${sliceLines(lines, 130, 896)}
`
    )
    write(
      'server/graph/core/proPuStack/index.ts',
      `export * from './schemas'
export * from './stackImpl'
`
    )
    shimExportAll(src, 'proPuStack')
    console.log('proPuStack → proPuStack/')
  }
}

console.log('split-mega-final: done')
