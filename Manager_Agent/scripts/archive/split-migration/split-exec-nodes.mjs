/**
 * B5: Split managerGraph.execNodes.ts → server/graph/nodes/exec/
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcPath = path.join(root, 'server/graph/nodes/managerGraph.execNodes.ts')
const outDir = path.join(root, 'server/graph/nodes/exec')
const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/)
const importBlock = lines.slice(0, 56).join('\n')

const nodeRanges = [
  ['dbNode', 151, 354],
  ['ragNode', 355, 498],
  ['codeNode', 499, 609],
  ['adminNode', 610, 694],
  ['crawlerNode', 695, 807],
  ['guiNode', 808, 892],
  ['cleanNode', 893, 943],
  ['visualizeNode', 944, 1009],
  ['reportNode', 1010, 1123],
  ['musicNode', 1124, 1155],
  ['videoNode', 1156, 1187],
  ['multimodalNode', 1188, 1237],
  ['adminConfirmResumeNode', 1238, 1318]
]

fs.mkdirSync(outDir, { recursive: true })

const typesTs = `${importBlock}

export type CreateExecutionNodesDeps = {
  ensureNotAborted: () => void
  opts: any
  policyPromise: Promise<any>
  defaultPolicy: () => any
  lastUserText: (messages: any[]) => string
  hasStrongDbAnchor: (text: string) => boolean
  callDbAgent: (input: any) => Promise<any>
  appendMetrics: (entry: any) => Promise<any>
  isDbNoData: (text: string) => boolean
  emitTrace: (entry: any) => void
  summarize: (text: string, max?: number) => string
  deriveScenarioKey: (text: string) => string
  callRagAgent: (input: any) => Promise<any>
  ragEvidenceFromProbe: (query: string, probeRag?: any) => any
  probeRagEvidence: (query: string) => Promise<any>
  parseRagClarifyPayload: (text: string) => { needsClarify: boolean; questions: string[] }
  mergeTaskPlan: (base: any, incoming: any, fallbackIntent: import('../../../utils/taskPlan').Intent, fallbackSteps: any[]) => any
  getEffectivePlanSteps: (state: any) => any[]
  mergeMeta: (state: any, patch: any) => any
  callCodeAgent: (input: any) => Promise<any>
  callAiAdminAgent: (input: any) => Promise<any>
  callCrawlerAgent: (input: any) => Promise<any>
  callLobsterAgent: (input: any) => Promise<any>
  parseCrawlerClarifyPayload: (raw: any) => { needsClarify: boolean; questions: string[] }
  crawlerTaskPlanPatch: (raw: any, fallbackQuery: string) => any
  runInternalAgent: (kind: 'clean' | 'visualize' | 'report', question: string, state: any, contextInput?: any) => Promise<any>
  filterCrawlerResultDomestic: (obj: any) => any
  callMultimodalAgent: (input: any) => Promise<any>
  callMusicAgent: (input: any) => Promise<any>
  callVideoAgent: (input: any) => Promise<any>
  ragRelevanceJudge: import('../../../utils/managerRagRelevance').RagRelevanceJudge
  ragEvidenceMatchJudge?: import('../../../utils/managerRagRelevance').RagEvidenceMatchJudge
  ragScopeHintJudge?: import('../../../utils/managerRagRelevance').RagScopeHintJudge
  llmInvoke: import('../../llm/managerGraph.taskConstraintsLlm').LlmInvokeFn
}
`

const helpersTs = `${importBlock}

export function compactStepInput(input: string, max = 260) {
  const s = String(input || '').replace(/\\s+/g, ' ').trim()
  return s.length > max ? \`\${s.slice(0, max)}…\` : s
}

export function buildAgentContext(context: string) {
  const raw = String(context || '').trim()
  if (!raw) return ''
  const chunks = raw
    .split(/\\n\\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => compactStepInput(x, 220))
  return chunks.slice(0, 3).join(' | ')
}
`

const contextTs = `${importBlock}
import type { CreateExecutionNodesDeps } from './types'
import { createAgentFailureNotifier } from '../../core/managerGraph.agentErrors'

export function createExecContext(deps: CreateExecutionNodesDeps) {
  const {
    ensureNotAborted,
    opts,
    policyPromise,
    defaultPolicy,
    lastUserText,
    hasStrongDbAnchor,
    callDbAgent,
    appendMetrics,
    isDbNoData,
    emitTrace,
    summarize,
    deriveScenarioKey,
    callRagAgent,
    ragEvidenceFromProbe,
    probeRagEvidence,
    parseRagClarifyPayload,
    mergeTaskPlan,
    getEffectivePlanSteps,
    mergeMeta,
    callCodeAgent,
    callAiAdminAgent,
    callCrawlerAgent,
    callLobsterAgent,
    parseCrawlerClarifyPayload,
    crawlerTaskPlanPatch,
    runInternalAgent,
    filterCrawlerResultDomestic,
    callMultimodalAgent,
    callMusicAgent,
    callVideoAgent,
    ragRelevanceJudge,
    ragEvidenceMatchJudge,
    ragScopeHintJudge,
    llmInvoke
  } = deps
  const notifyAgentFailure = createAgentFailureNotifier(opts.sendEvent, opts.runId)
  return {
    ensureNotAborted,
    opts,
    policyPromise,
    defaultPolicy,
    lastUserText,
    hasStrongDbAnchor,
    callDbAgent,
    appendMetrics,
    isDbNoData,
    emitTrace,
    summarize,
    deriveScenarioKey,
    callRagAgent,
    ragEvidenceFromProbe,
    probeRagEvidence,
    parseRagClarifyPayload,
    mergeTaskPlan,
    getEffectivePlanSteps,
    mergeMeta,
    callCodeAgent,
    callAiAdminAgent,
    callCrawlerAgent,
    callLobsterAgent,
    parseCrawlerClarifyPayload,
    crawlerTaskPlanPatch,
    runInternalAgent,
    filterCrawlerResultDomestic,
    callMultimodalAgent,
    callMusicAgent,
    callVideoAgent,
    ragRelevanceJudge,
    ragEvidenceMatchJudge,
    ragScopeHintJudge,
    llmInvoke,
    notifyAgentFailure
  }
}

export type ExecContext = ReturnType<typeof createExecContext>
`

fs.writeFileSync(path.join(outDir, 'types.ts'), typesTs)
fs.writeFileSync(path.join(outDir, 'helpers.ts'), helpersTs.replace(importBlock + '\n\n', ''))
fs.writeFileSync(path.join(outDir, 'context.ts'), contextTs)

const buildImports = `${importBlock}
import type { ManagerGraphState } from '../../state/managerGraph.state'
import type { CreateExecutionNodesDeps } from './types'
import { createExecContext, type ExecContext } from './context'
import { compactStepInput, buildAgentContext } from './helpers'
`

for (const [name, start, end] of nodeRanges) {
  let body = lines.slice(start - 1, end).join('\n')
  body = body.replace(/^  const \w+Node = async/, '  return async')
  const fnName = `build${name.charAt(0).toUpperCase() + name.slice(1)}`
  const file = `${buildImports}

export function ${fnName}(deps: CreateExecutionNodesDeps) {
  const {
    ensureNotAborted,
    opts,
    policyPromise,
    defaultPolicy,
    lastUserText,
    hasStrongDbAnchor,
    callDbAgent,
    appendMetrics,
    isDbNoData,
    emitTrace,
    summarize,
    deriveScenarioKey,
    callRagAgent,
    ragEvidenceFromProbe,
    probeRagEvidence,
    parseRagClarifyPayload,
    mergeTaskPlan,
    getEffectivePlanSteps,
    mergeMeta,
    callCodeAgent,
    callAiAdminAgent,
    callCrawlerAgent,
    callLobsterAgent,
    parseCrawlerClarifyPayload,
    crawlerTaskPlanPatch,
    runInternalAgent,
    filterCrawlerResultDomestic,
    callMultimodalAgent,
    callMusicAgent,
    callVideoAgent,
    ragRelevanceJudge,
    ragEvidenceMatchJudge,
    ragScopeHintJudge,
    llmInvoke,
    notifyAgentFailure
  } = createExecContext(deps)

${body}
}
`
  fs.writeFileSync(path.join(outDir, `${name}.ts`), file)
}

const factoryImports = nodeRanges
  .map(([name]) => `import { build${name.charAt(0).toUpperCase() + name.slice(1)} } from './${name}'`)
  .join('\n')

const factory = `${importBlock}
import type { CreateExecutionNodesDeps } from './types'
${factoryImports}

export type { CreateExecutionNodesDeps } from './types'

export function createExecutionNodes(deps: CreateExecutionNodesDeps) {
  return {
    dbNode: buildDbNode(deps),
    ragNode: buildRagNode(deps),
    codeNode: buildCodeNode(deps),
    adminNode: buildAdminNode(deps),
    adminConfirmResumeNode: buildAdminConfirmResumeNode(deps),
    crawlerNode: buildCrawlerNode(deps),
    guiNode: buildGuiNode(deps),
    cleanNode: buildCleanNode(deps),
    visualizeNode: buildVisualizeNode(deps),
    reportNode: buildReportNode(deps),
    multimodalNode: buildMultimodalNode(deps),
    musicNode: buildMusicNode(deps),
    videoNode: buildVideoNode(deps)
  }
}
`

fs.writeFileSync(path.join(outDir, 'createExecutionNodes.ts'), factory)
fs.writeFileSync(
  path.join(outDir, 'index.ts'),
  `export { createExecutionNodes, type CreateExecutionNodesDeps } from './createExecutionNodes'\n`
)
fs.writeFileSync(
  srcPath,
  `/** B5: exec nodes split — re-export shim */\nexport { createExecutionNodes, type CreateExecutionNodesDeps } from './exec'\n`
)

console.log(`split-exec-nodes: ${nodeRanges.length} node modules in server/graph/nodes/exec/`)
