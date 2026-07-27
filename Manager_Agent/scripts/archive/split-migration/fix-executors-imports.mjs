/**
 * Fix executor module paths and cross-imports after split-agent-executors.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), 'server/graph/core/executors')

function fixPaths(content) {
  return content
    .replaceAll("from './managerGraph.", "from '../managerGraph.")
    .replaceAll("from './managerGraphGuiTaskPayload'", "from '../managerGraphGuiTaskPayload'")
    .replaceAll("from '../llm/", "from '../../llm/")
    .replaceAll("from '../state/", "from '../../state/")
}

for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.ts') || file === 'index.ts') continue
  const p = path.join(dir, file)
  fs.writeFileSync(p, fixPaths(fs.readFileSync(p, 'utf8')))
}

// Slim types.ts — types only
const typesOnly = `import type { RagRelevanceJudge, RagEvidenceMatchJudge, RagScopeHintJudge } from '../../../utils/managerRagRelevance'
import type { ManagerGraphState } from '../../state/managerGraph.state'
import type { Intent, Step } from '../../../utils/taskPlan'

export type AgentExecutorOpts = {
  runId: string
  threadId?: string
  sessionId?: string
  userId?: string
  timeoutMs: number
  signal?: AbortSignal
  dbAgentWsUrl: string
  dbAgentHttpUrl: string
  dbId?: string
  ragAgentHttpUrl: string
  ragHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ragConversationId?: string
  codeAgentWsUrl: string
  crawlerAgentWsUrl: string
  lobsterAgentWsUrl: string
  aiAdminAgentWsUrl: string
  multimodalAgentHttpUrl: string
  musicAgentWsUrl: string
  videoAgentWsUrl: string
  sendEvent: (event: { event: string; data?: unknown; from?: string }) => void
}

export type AgentExecutorDeps = {
  callDbAgent: (input: Record<string, unknown>) => Promise<import('../../../utils/agents/types').DbResult>
  callRagAgent: (input: Record<string, unknown>) => Promise<string | import('../../../utils/agents/agentResult').AgentCallResult>
  callCrawlerAgent: (input: Record<string, unknown>) => Promise<unknown>
  callLobsterAgent: (input: Record<string, unknown>) => Promise<unknown>
  callCodeAgent: (input: Record<string, unknown>) => Promise<{ answer: string; meta?: unknown }>
  callAiAdminAgent: (input: Record<string, unknown>) => Promise<unknown>
  callMultimodalAgent: (input: Record<string, unknown>) => Promise<string | import('../../../utils/agents/agentResult').AgentCallResult>
  callMusicAgent: (input: Record<string, unknown>) => Promise<string | import('../../../utils/agents/agentResult').AgentCallResult>
  callVideoAgent: (input: Record<string, unknown>) => Promise<string | import('../../../utils/agents/agentResult').AgentCallResult>
  probeRagEvidence: (query: string) => Promise<unknown>
  ragEvidenceFromProbe?: (query: string, probeRag?: unknown) => unknown
  filterCrawlerResultDomestic: (obj: unknown) => unknown
  isDbNoData: (text: string) => boolean
  ragRelevanceJudge: RagRelevanceJudge
  ragEvidenceMatchJudge?: RagEvidenceMatchJudge
  ragScopeHintJudge?: RagScopeHintJudge
  lastUserText: (messages: ManagerGraphState['messages']) => string
  buildClarifyQuestions?: (text: string, intent?: Intent, probe?: ManagerGraphState['probe']) => string[]
  runInternalAgent?: (
    kind: 'clean' | 'visualize' | 'report',
    question: string,
    state: ManagerGraphState,
    contextInput?: unknown
  ) => Promise<string | { answer: string; resources?: unknown; meta?: unknown }>
}

export type AgentStepSuccess = {
  ok: true
  agent: Step['agent']
  output: string
  query: string
  parsed?: unknown
  meta?: unknown
  evidence?: Record<string, unknown>
  clarifyQuestions?: string[]
}

export type AgentStepFailure = {
  ok: false
  agent: Step['agent']
  output: string
  query: string
  error: string
}

export type AgentStepOutcome = AgentStepSuccess | AgentStepFailure

export type VoteScore = {
  score: number
  reason?: string
}
`
fs.writeFileSync(path.join(dir, 'types.ts'), typesOnly)

// dispatchExecutor cross-imports
const dispatchHeader = `import type { ManagerCrawlerLlmHints } from '../../../utils/managerCrawlerTaskLlm'
import type { LlmInvokeFn } from '../../llm/managerGraph.taskConstraintsLlm'
import type { ManagerGraphState } from '../../state/managerGraph.state'
import type { Step } from '../../../utils/taskPlan'
import type { AgentExecutorDeps, AgentExecutorOpts, AgentStepOutcome, VoteScore } from './types'
import { executeDbStep } from './dbExecutor'
import { executeRagStep } from './ragExecutor'
import { executeCrawlerStep } from './crawlerExecutor'
import { executeGuiStep } from './guiExecutor'
import { executeAdminStep } from './adminExecutor'
import { executeCodeStep } from './codeExecutor'
import { executeMultimodalStep, executeMusicStep, executeVideoStep } from './mediaExecutors'
import { executeInternalStep } from './internalExecutor'

`
const dispatchPath = path.join(dir, 'dispatchExecutor.ts')
let dispatchBody = fs.readFileSync(dispatchPath, 'utf8')
const fnStart = dispatchBody.indexOf('export async function dispatchPlanAgentStep')
dispatchBody = dispatchHeader + dispatchBody.slice(fnStart)
fs.writeFileSync(dispatchPath, dispatchBody)

// bundle.ts slim header
const bundleHeader = `import type { ManagerGraphState } from '../../state/managerGraph.state'
import type { Step } from '../../../utils/taskPlan'
import { buildActionExecEffectiveQuery } from '../managerGraph.stepIsolation'
import { resolveAdminAutoConfirm } from '../managerGraph.writeGate'
import type { AgentExecutorDeps, AgentExecutorOpts } from './types'

`
const bundlePath = path.join(dir, 'bundle.ts')
let bundleBody = fs.readFileSync(bundlePath, 'utf8')
const bStart = bundleBody.indexOf('export function buildAgentExecutorBundle')
bundleBody = bundleHeader + bundleBody.slice(bStart)
fs.writeFileSync(bundlePath, bundleBody)

// Remove duplicate VoteScore from stepOutcome
let stepOutcome = fs.readFileSync(path.join(dir, 'stepOutcome.ts'), 'utf8')
stepOutcome = stepOutcome.replace(/export type VoteScore = \{[\s\S]*?\}\n\n/, '')
fs.writeFileSync(path.join(dir, 'stepOutcome.ts'), stepOutcome)

console.log('fix-executors-imports: done')
