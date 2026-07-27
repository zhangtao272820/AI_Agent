/**
 * B5 batch-3: text core split + createManagerGraph wiring + plan query helpers
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

function shim(rel, sub) {
  write(rel, `/** B5 split — re-export shim */\nexport * from '${sub}'\n`)
}

// ── 1. managerGraph.text.ts → core/text/ ───────────────────────────────────
{
  const src = 'server/graph/core/managerGraph.text.ts'
  const lines = readLines(src)
  const importBlock = lines.slice(0, 9).join('\n').replace(/from '\.\//g, "from '../")

  const routing = `${importBlock.replace("from '../managerGraph.", "from '../")}
import { isExplicitMultiRequest } from './routeAdvisory'

${sliceLines(lines, 23, 110)}
`

  const clarify = `${importBlock.replace("from '../managerGraph.", "from '../")}

${sliceLines(lines, 112, 194)}
`

  const scenario = `${importBlock.replace("from '../managerGraph.", "from '../")}
import { hasStructuralMultiLineBullets } from './routingContext'

${sliceLines(lines, 196, 346)}
`

  const constraints = `${importBlock.replace("from '../managerGraph.", "from '../")}

${sliceLines(lines, 348, 456)}
`

  const routeAdvisory = `${importBlock.replace("from '../managerGraph.", "from '../")}
import {
  hasStructuralMultiLineBullets,
  preferCurrentTurnScope,
  routingConversationContext
} from './routingContext'

${sliceLines(lines, 458, 621)}
`

  const misc = `${importBlock.replace("from '../managerGraph.", "from '../")}
import { hasStrongDbAnchor } from './routeAdvisory'

/** 用户是否点名知识库/文档数据源 — 由路由模型 needsClarify/rationale 表达，此处恒 false 避免正则误判。 */
export function isKnowledgeBaseAnchoredQuery(_text: string): boolean {
  return false
}

/** 结构化库表用语锚定 — 仅识别内嵌 SQL 片段（技术特征，非业务词表）。 */
export function isStructuredDatabaseAnchoredQuery(text: string): boolean {
  return hasStrongDbAnchor(text)
}

${sliceLines(lines, 242, 252)}
${sliceLines(lines, 268, 282)}
`

  write('server/graph/core/text/routingContext.ts', routing)
  write('server/graph/core/text/clarifyPayloads.ts', clarify)
  write('server/graph/core/text/scenarioAndFormat.ts', scenario)
  write('server/graph/core/text/constraintsQuery.ts', constraints)
  write('server/graph/core/text/routeAdvisory.ts', routeAdvisory)
  write('server/graph/core/text/misc.ts', misc)
  write(
    'server/graph/core/text/index.ts',
    `export * from './routingContext'
export * from './clarifyPayloads'
export * from './scenarioAndFormat'
export * from './constraintsQuery'
export * from './routeAdvisory'
export * from './misc'
`
  )
  shim('server/graph/core/managerGraph.text.ts', './text/index')
  console.log('text → server/graph/core/text/')
}

// ── 2. createManagerGraph.ts → runtime bundle + wire nodes ─────────────────
{
  const src = 'server/graph/state/createManagerGraph.ts'
  const lines = readLines(src)
  const importEnd = lines.findIndex((l) => l.startsWith('export function createManagerGraph'))
  const importBlock = lines.slice(0, importEnd).join('\n')

  const runtimeBody = sliceLines(lines, 255, 380)
  write(
    'server/graph/state/managerGraphRuntimeBundle.ts',
    `${importBlock}

export type ManagerGraphRuntimeBundle = {
  summarize: (text: string, max?: number) => string
  formatReferences: (evidence: any[]) => string
  redactSecrets: (text: string) => string
  emitTrace: (data: any, from?: string) => void
  runInternalAgent: ReturnType<typeof createInternalCollaborators>['runInternalAgent']
  runAlwaysInternalCollaborators: ReturnType<typeof createInternalCollaborators>['runAlwaysInternalCollaborators']
  fetchJson: (url: string, body: any, timeoutMs: number) => Promise<any>
  ragEvidenceFromProbe: (query: string, probe: any) => any
  probeRagEvidence: (query: string) => Promise<any>
}

export function buildManagerGraphRuntimeBundle(input: {
  opts: Parameters<typeof createManagerGraph>[0]
  ensureNotAborted: () => void
  getModel: (modelName: string, temperature?: number) => ChatOpenAI
  traceRun: <T>(name: string, fn: () => Promise<T>, extra?: Record<string, any>) => Promise<T>
  mergeResources: (state: any, patch: Partial<any>) => any
  appendMetrics: typeof appendMetrics
  timeLeftMs: (resources: any) => number
}): ManagerGraphRuntimeBundle {
  const { opts, ensureNotAborted, getModel, traceRun, mergeResources, appendMetrics, timeLeftMs } = input
${runtimeBody.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}
  return { summarize, formatReferences, redactSecrets, emitTrace, runInternalAgent, runAlwaysInternalCollaborators, fetchJson, ragEvidenceFromProbe, probeRagEvidence }
}
`
  )

  const wireBody = sliceLines(lines, 382, 746)
  write(
    'server/graph/state/wireManagerGraphNodes.ts',
    `${importBlock}

export type WiredManagerGraphNodes = ReturnType<typeof wireManagerGraphNodes>

export function wireManagerGraphNodes(ctx: {
  opts: Parameters<typeof createManagerGraph>[0]
  policyDir: string
  ensureNotAborted: () => void
  mergeMeta: (state: any, patch: Record<string, any>) => any
  mergeResources: (state: any, patch: Partial<any>) => any
  llmInvoke: ReturnType<typeof createManagerRuntime>['llmInvoke']
  lastUserText: typeof lastUserText
  fetchJson: (url: string, body: any, timeoutMs: number) => Promise<any>
  policyPromise: Promise<any>
  defaultPolicy: typeof defaultPolicy
  appendMemory: typeof appendMemory
  appendMetrics: typeof appendMetrics
  safeJsonParse: typeof safeJsonParse
  percentile: typeof percentile
  summarize: (text: string, max?: number) => string
  emitTrace: (data: any, from?: string) => void
  probeRagEvidence: (query: string) => Promise<any>
  ragEvidenceFromProbe: (query: string, probe: any) => any
  runInternalAgent: ManagerGraphRuntimeBundle['runInternalAgent']
  runAlwaysInternalCollaborators: ManagerGraphRuntimeBundle['runAlwaysInternalCollaborators']
  formatReferences: ManagerGraphRuntimeBundle['formatReferences']
  redactSecrets: ManagerGraphRuntimeBundle['redactSecrets']
  timeLeftMs: (resources: any) => number
  buildClarifyQuestions: typeof buildClarifyQuestions
  FixStrategySchema: typeof FixStrategySchema
  getModel: (modelName: string, temperature?: number) => ChatOpenAI
  traceRun: <T>(name: string, fn: () => Promise<T>, extra?: Record<string, any>) => Promise<T>
}) {
  const {
    opts,
    policyDir,
    ensureNotAborted,
    mergeMeta,
    mergeResources,
    llmInvoke,
    lastUserText,
    fetchJson,
    policyPromise,
    defaultPolicy,
    appendMemory,
    appendMetrics,
    safeJsonParse,
    percentile,
    summarize,
    emitTrace,
    probeRagEvidence,
    ragEvidenceFromProbe,
    runInternalAgent,
    runAlwaysInternalCollaborators,
    formatReferences,
    redactSecrets,
    timeLeftMs,
    buildClarifyQuestions,
    FixStrategySchema,
    getModel,
    traceRun
  } = ctx
${wireBody}
  return {
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
    voteAggregatorNode,
    planLinterNode,
    dbNode,
    ragNode,
    codeNode,
    adminNode,
    adminConfirmResumeNode,
    crawlerNode,
    guiNode,
    cleanNode,
    visualizeNode,
    reportNode,
    multimodalNode,
    musicNode,
    videoNode,
    multiNode,
    synthNode,
    criticNode,
    verifierNode,
    finalizeNode,
    evaluatorNode,
    optimizerNode,
    monitorNode,
    fixNode,
    planPreviewNode
  }
}
`
  )

  const beforeRuntime = sliceLines(lines, importEnd + 1, 254)
  const afterWire = sliceLines(lines, 748)
  write(
    src,
    `${importBlock}
import { buildManagerGraphRuntimeBundle, type ManagerGraphRuntimeBundle } from './managerGraphRuntimeBundle'
import { wireManagerGraphNodes } from './wireManagerGraphNodes'

export function createManagerGraph(opts: Parameters<typeof createManagerGraph>[0]) {
${beforeRuntime}
  const {
    summarize,
    formatReferences,
    redactSecrets,
    emitTrace,
    runInternalAgent,
    runAlwaysInternalCollaborators,
    fetchJson,
    ragEvidenceFromProbe,
    probeRagEvidence
  } = buildManagerGraphRuntimeBundle({
    opts,
    ensureNotAborted,
    getModel,
    traceRun,
    mergeResources,
    appendMetrics,
    timeLeftMs
  })

  const nodes = wireManagerGraphNodes({
    opts,
    policyDir,
    ensureNotAborted,
    mergeMeta,
    mergeResources,
    llmInvoke,
    lastUserText,
    fetchJson,
    policyPromise,
    defaultPolicy,
    appendMemory,
    appendMetrics,
    safeJsonParse,
    percentile,
    summarize,
    emitTrace,
    probeRagEvidence,
    ragEvidenceFromProbe,
    runInternalAgent,
    runAlwaysInternalCollaborators,
    formatReferences,
    redactSecrets,
    timeLeftMs,
    buildClarifyQuestions,
    FixStrategySchema,
    getModel,
    traceRun
  })

  const {
    resourceNode,
    toolHealthNode,
    turnScopeNode,
    probeNode,
    metacogNode,
    securityNode,
    decomposeNode,
    intentClassifyNode,
    routerNode,
    orchestrateNode,
    prefetchNode,
    webSearchNode,
    clarifyNode,
    planNode,
    schedulerNode,
    executionModeNode,
    voteAggregatorNode,
    dbNode,
    ragNode,
    codeNode,
    adminNode,
    adminConfirmResumeNode,
    crawlerNode,
    guiNode,
    cleanNode,
    visualizeNode,
    reportNode,
    multimodalNode,
    musicNode,
    videoNode,
    multiNode,
    planLinterNode,
    planPreviewNode,
    synthNode,
    evaluatorNode,
    criticNode,
    optimizerNode,
    verifierNode,
    monitorNode,
    finalizeNode,
    fixNode
  } = nodes

${afterWire}
}
`
  )
  console.log('createManagerGraph → runtimeBundle + wireNodes')
}

// ── 3. plan/createPlanNode.ts → planQueryHelpers + planNodeRun ─────────────
{
  const src = 'server/graph/nodes/plan/createPlanNode.ts'
  const lines = readLines(src)
  const importBlock = lines.slice(0, 59).join('\n')
  const queryHelpers = sliceLines(lines, 81, 143)

  write(
    'server/graph/nodes/plan/planQueryHelpers.ts',
    `${importBlock}
import type { CreatePlanNodeDeps } from './types'

export function createPlanQueryHelpers(deps: CreatePlanNodeDeps) {
  const { opts, lastUserText, runId } = deps
${queryHelpers.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}
  return { publishPlanUi, planHeuristicsFor, plannerQueryForAgent, formatBlueprintStepQuery }
}
`
  )

  const runBody = sliceLines(lines, 146)
  write(
    'server/graph/nodes/plan/planNodeRun.ts',
    `${importBlock}
import type { CreatePlanNodeDeps } from './types'
import type { createPlanQueryHelpers } from './planQueryHelpers'

export function createPlanNodeRun(
  deps: CreatePlanNodeDeps,
  helpers: ReturnType<typeof createPlanQueryHelpers>
) {
  const {
    ensureNotAborted,
    opts,
    lastUserText,
    enforcePlanConstraints,
    buildTaskPlan,
    appendMemory,
    needsDataFoundation,
    fetchDbTaskPlan,
    mergeTaskPlan,
    llmInvoke,
    PlanSchema,
    safeJsonParse,
    enforcePlanCoverage,
    getPlanQualityHint,
    recordPlanOutcome,
    runId
  } = deps
  const { publishPlanUi, planHeuristicsFor, plannerQueryForAgent, formatBlueprintStepQuery } = helpers

  return async (state: any) => {
${runBody.split('\n').map((l) => (l ? `    ${l}` : l)).join('\n')}
  }
}
`
  )

  write(
    src,
    `${importBlock}
import { createPlanQueryHelpers } from './planQueryHelpers'
import { createPlanNodeRun } from './planNodeRun'
import type { CreatePlanNodeDeps } from './types'

export function createPlanNode(deps: CreatePlanNodeDeps) {
  return createPlanNodeRun(deps, createPlanQueryHelpers(deps))
}
`
  )
  write(
    'server/graph/nodes/plan/index.ts',
    `export { createPlanNode, type CreatePlanNodeDeps } from './createPlanNode'
export { PLANNER_RULES_FALLBACK, stripAdminStepsIfBlocked } from './helpers'
export { createPlanQueryHelpers } from './planQueryHelpers'
`
  )
  console.log('plan → planQueryHelpers + planNodeRun')
}

console.log('split-mega-batch3: done')
