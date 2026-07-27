/**
 * B5 batch-7/8: NodeRun body extraction + wireManagerGraphNodes 3-phase split
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
  if (end1 == null) return lines.slice(start1 - 1).join('\n')
  return lines.slice(start1 - 1, end1).join('\n')
}

/** Extract async body from *NodeRun.ts → *NodeBody.ts + thin run shim */
function extractNodeRunBody({ srcRun, outBody, runExport, bodyExport, extraRunImports = '' }) {
  const lines = readLines(srcRun)
  const asyncIdx = lines.findIndex((l) => /return async \(state/.test(l))
  if (asyncIdx < 0) throw new Error(`${srcRun}: no return async found`)
  const importEnd = lines.findIndex((l) => l.startsWith(`export function ${runExport}`))
  const importBlock = lines.slice(0, importEnd).join('\n')
  const factoryStart = importEnd
  let factoryEnd = lines.length
  // body: lines after `return async ... => {` until matching close of async (last `}` before factory close)
  const bodyStart = asyncIdx + 1
  let bodyEnd = lines.length - 1
  // walk back: last line is `}`, prev is `}` closing async
  while (bodyEnd > bodyStart && lines[bodyEnd - 1]?.trim() !== '}') bodyEnd--
  const body = sliceLines(lines, bodyStart + 1, bodyEnd - 1)

  const factoryBlock = sliceLines(lines, factoryStart + 1, asyncIdx)
  // factoryBlock is deps destructuring between export function and return async

  write(
    outBody,
    `${importBlock}

${factoryBlock}
export async function ${bodyExport}(state: any) {
${body.split('\n').map((l) => (l.startsWith('        ') ? l.slice(2) : l)).join('\n')}
}
`
  )

  write(
    srcRun,
    `${importBlock}
import { ${bodyExport} } from './${path.basename(outBody, '.ts')}'
${extraRunImports}

export function ${runExport}(deps: any, helpers?: any) {
  return ${bodyExport}(deps, helpers)
}
`
  )

  // Fix plan pattern: createPlanNodeRun(deps, helpers) - body needs deps+helpers
  if (helpers !== false) {
    const bodyLines = readLines(outBody)
    const fixed = bodyLines
      .join('\n')
      .replace(
        `export async function ${bodyExport}(state: any) {`,
        `export async function ${bodyExport}(deps: any, helpers: any) {
  const {
${sliceLines(readLines(srcRun), 0, 0)}`
      )
  }
}

function extractNodeRunBody2({ srcRun, outBody, runExport, bodyExport, hasHelpers }) {
  const lines = readLines(srcRun)
  const exportIdx = lines.findIndex((l) => l.startsWith(`export function ${runExport}`))
  const asyncIdx = lines.findIndex((l, i) => i > exportIdx && /return async \(state/.test(l))
  if (asyncIdx < 0) throw new Error(`${srcRun}: no return async`)

  const importBlock = lines.slice(0, exportIdx).join('\n')
  const headerEnd = asyncIdx
  const header = sliceLines(lines, exportIdx + 1, headerEnd) // deps destructuring inside factory

  // find closing braces: async closes at lines.length-2, factory at lines.length-1
  const bodyInnerStart = asyncIdx + 1
  const bodyInnerEnd = lines.length - 2
  const body = sliceLines(lines, bodyInnerStart + 1, bodyInnerEnd)

  const bodyFn = hasHelpers
    ? `export async function ${bodyExport}(state: any, deps: any, helpers: any) {
  ${header.trim()}
${body}
}`
    : `export async function ${bodyExport}(state: any, deps: any) {
  ${header.trim()}
${body}
}`

  write(outBody, `${importBlock}\n\n${bodyFn}\n`)

  const shim = hasHelpers
    ? `${importBlock}
import { ${bodyExport} } from './${path.basename(outBody, '.ts')}'
import type { CreatePlanNodeDeps } from './types'
import type { createPlanQueryHelpers } from './planQueryHelpers'

export function ${runExport}(deps: CreatePlanNodeDeps, helpers: ReturnType<typeof createPlanQueryHelpers>) {
  return async (state: any) => ${bodyExport}(state, deps, helpers)
}
`
    : `${importBlock}
import { ${bodyExport} } from './${path.basename(outBody, '.ts')}'
import type { CreateMultiNodeDeps } from './types'

export function ${runExport}(deps: CreateMultiNodeDeps) {
  return async (state: any) => ${bodyExport}(state, deps)
}
`

  const shimRouter = `${importBlock}
import { ${bodyExport} } from './${path.basename(outBody, '.ts')}'
import type { CreateRouterNodeDeps } from './types'

export function ${runExport}(deps: CreateRouterNodeDeps) {
  return async (state: any) => ${bodyExport}(state, deps)
}
`

  write(srcRun, hasHelpers === 'plan' ? shim : hasHelpers === 'router' ? shimRouter : shim.replace('CreateMultiNodeDeps', 'CreateMultiNodeDeps'))
  console.log(`split: ${srcRun} → ${path.basename(outBody)}`)
}

// ── batch-7: plan / multi / router body extraction ──
extractNodeRunBody2({
  srcRun: 'server/graph/nodes/plan/planNodeRun.ts',
  outBody: 'server/graph/nodes/plan/planNodeBody.ts',
  runExport: 'createPlanNodeRun',
  bodyExport: 'runPlanNodeBody',
  hasHelpers: 'plan'
})
extractNodeRunBody2({
  srcRun: 'server/graph/nodes/multi/multiNodeRun.ts',
  outBody: 'server/graph/nodes/multi/multiNodeBody.ts',
  runExport: 'createMultiNodeRun',
  bodyExport: 'runMultiNodeBody',
  hasHelpers: false
})
extractNodeRunBody2({
  srcRun: 'server/graph/nodes/router/routerNodeRun.ts',
  outBody: 'server/graph/nodes/router/routerNodeBody.ts',
  runExport: 'createRouterNodeRun',
  bodyExport: 'runRouterNodeBody',
  hasHelpers: 'router'
})

// ── batch-8: wireManagerGraphNodes 3-phase ──
{
  const src = 'server/graph/state/wireManagerGraphNodes.ts'
  const lines = readLines(src)
  const importEnd = lines.findIndex((l) => l.startsWith('export type WiredManagerGraphNodes'))
  const importBlock = lines.slice(0, importEnd).join('\n')
  const fnStart = lines.findIndex((l) => l.startsWith('export function wireManagerGraphNodes'))
  const ctxOpen = lines.findIndex((l, i) => i > fnStart && l.includes('const {'))
  const preflightStart = lines.findIndex((l) => l.includes('const resourceNode = createResourceNode'))
  const pipelineStart = lines.findIndex((l) => l.includes('const getPlanQualityHint = async'))
  const execStart = lines.findIndex((l) => l.includes('const planLinterNode = createPlanLinterNode'))
  const returnStart = lines.findIndex((l) => l.trim() === 'return {')
  const fnEnd = lines.length

  const sharedCtxType = sliceLines(lines, fnStart, ctxOpen)
  const ctxDestruct = sliceLines(lines, ctxOpen, preflightStart)

  const preflightBlock = sliceLines(lines, preflightStart, pipelineStart)
  const pipelineBlock = sliceLines(lines, pipelineStart, execStart)
  const execBlock = sliceLines(lines, execStart, returnStart)
  const returnBlock = sliceLines(lines, returnStart, fnEnd - 1)

  const sharedImports = `${importBlock}

export type WireGraphCtx = Parameters<typeof wireManagerGraphNodes>[0]

export type WireGraphPreflight = {
${preflightBlock
  .split('\n')
  .filter((l) => /^  const \w+Node = /.test(l))
  .map((l) => {
    const m = l.match(/const (\w+) =/)
    return `  ${m[1]}: any`
  })
  .join('\n')}
  getPlanQualityHint: () => Promise<string>
  ragRelevanceJudge: any
  ragEvidenceMatchJudge: any
  ragScopeHintJudge: any
}

export function wireGraphPreflightNodes(ctx: WireGraphCtx): WireGraphPreflight {
${ctxDestruct}
${preflightBlock}
${pipelineBlock.split('\n').filter((l) => l.includes('getPlanQualityHint') || l.includes('ragRelevanceJudge') || l.includes('ragEvidenceMatchJudge') || l.includes('ragScopeHintJudge') || l.includes('ragJudgeModel') || l.includes('ragJudgeDeps')).join('\n')}
  return {
${preflightBlock
  .split('\n')
  .filter((l) => /^  const (\w+) = /.test(l))
  .map((l) => {
    const m = l.match(/const (\w+) =/)
    return `    ${m[1]},`
  })
  .join('\n')}
    getPlanQualityHint,
    ragRelevanceJudge,
    ragEvidenceMatchJudge,
    ragScopeHintJudge
  }
}
`

  // Simpler wire split: preflight+pipeline in one file, exec+final in another
  write(
    'server/graph/state/wireGraphRoutePhase.ts',
    `${importBlock}

type WireCtx = Parameters<typeof import('./wireManagerGraphNodes').wireManagerGraphNodes>[0]

export function wireGraphRoutePhase(ctx: WireCtx) {
${ctxDestruct}
${preflightBlock}
${pipelineBlock}
  return {
    getPlanQualityHint,
    ragRelevanceJudge,
    ragEvidenceMatchJudge,
    ragScopeHintJudge,
    resourceNode,
    toolHealthNode,
    metacogNode,
    securityNode,
    clarifyNode,
    turnScopeNode,
    probeNode,
    decomposeNode,
    intentClassifyNode,
    webSearchNode,
    prefetchNode,
    routerNode,
    orchestrateNode,
    planNode,
    schedulerNode,
    executionModeNode,
    voteAggregatorNode
  }
}
`
  )

  write(
    'server/graph/state/wireGraphExecPhase.ts',
    `${importBlock}

type WireCtx = Parameters<typeof import('./wireManagerGraphNodes').wireManagerGraphNodes>[0]
type RoutePhase = ReturnType<typeof import('./wireGraphRoutePhase').wireGraphRoutePhase>

export function wireGraphExecPhase(ctx: WireCtx, route: RoutePhase) {
  const { getPlanQualityHint, ragRelevanceJudge, ragEvidenceMatchJudge, ragScopeHintJudge } = route
${execBlock}
${returnBlock}
}
`
  )

  write(
    'server/graph/state/wireManagerGraphNodes.ts',
    `${importBlock}
import { wireGraphRoutePhase } from './wireGraphRoutePhase'
import { wireGraphExecPhase } from './wireGraphExecPhase'

${sharedCtxType}
export function wireManagerGraphNodes(ctx: WireGraphCtx) {
  const route = wireGraphRoutePhase(ctx)
  return { ...route, ...wireGraphExecPhase(ctx, route) }
}
`
  )
  console.log('split: wireManagerGraphNodes → wireGraphRoutePhase + wireGraphExecPhase')
}

// ── batch-8: unifiedLearning + layeredMemory half split ──
function splitCoreModule({ src, dir, partA, partB, splitLine }) {
  const lines = readLines(src)
  const importEnd = lines.findIndex((l) => /^export /.test(l))
  const importBlock = lines.slice(0, importEnd).join('\n')
  const aBlock = sliceLines(lines, importEnd, splitLine)
  const bBlock = sliceLines(lines, splitLine)

  write(`${dir}/${partA}.ts`, `${importBlock}\n\n${aBlock}\n`)
  write(`${dir}/${partB}.ts`, `${bBlock}\n`)
  write(src, `/** @deprecated B5 batch-8 — split barrel */\nexport * from './${path.basename(dir)}/${partA}'\nexport * from './${path.basename(dir)}/${partB}'\n`)
  console.log(`split: ${src} → ${dir}/{${partA},${partB}}`)
}

splitCoreModule({
  src: 'server/graph/core/managerGraph.unifiedLearning.ts',
  dir: 'server/graph/core/unifiedLearning',
  partA: 'record',
  partB: 'indexers',
  splitLine: 280
})
splitCoreModule({
  src: 'server/graph/core/managerGraph.layeredMemory.ts',
  dir: 'server/graph/core/layeredMemory',
  partA: 'record',
  partB: 'recall',
  splitLine: 280
})

console.log('split-mega-batch7-8: done')
