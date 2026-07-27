/**
 * Graph batch-5: extract duplicate utils imports in state/wire + createManagerGraph
 * into wireGraphUtilsDeps.ts; dedupe identical import blocks.
 * Usage: node scripts/migrate-graph-wire-utils.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const root = process.cwd()
const stateDir = path.join(root, 'server/graph/state')

const WIRE_UTILS_DEPS = `/** Shared utils-layer imports for graph compile / wire modules. */
export { createManagerChatOpenAI } from '../../utils/chat/managerChatOpenAI'
export {
  callAiAdminAgent,
  callCodeAgent,
  callCrawlerAgent,
  callLobsterAgent,
  callDbAgent,
  callMultimodalAgent,
  callMusicAgent,
  callVideoAgent,
  callRagAgent,
  fetchDbTaskPlan
} from '../../utils/platform/agentClients'
export { ragProbeTimeoutMs } from '../../utils/agents/ragClient'
export { buildAgentTraceHeaders } from '../../utils/agents/agentTrace'
export {
  EntitiesSchema,
  ForceIntentSchema,
  IntentSchema,
  PlanSchema,
  RouteSchema,
  StepSchema,
  normalizeEntities,
  type ForceIntent,
  type Intent,
  type Step,
  type TaskPlan
} from '../../utils/shared/taskPlan'
export {
  createRagRelevanceJudge,
  createRagEvidenceMatchJudge,
  createRagScopeHintJudge
} from '../../utils/rag/managerRagRelevance'
`

const IMPORT_BLOCK = [
  "import { createManagerChatOpenAI } from '../../utils/chat/managerChatOpenAI'",
  `import {
  callAiAdminAgent,
  callCodeAgent,
  callCrawlerAgent,
  callLobsterAgent,
  callDbAgent,
  callMultimodalAgent,
  callMusicAgent,
  callVideoAgent,
  callRagAgent,
  fetchDbTaskPlan
} from '../../utils/platform/agentClients'`,
  "import { ragProbeTimeoutMs } from '../../utils/agents/ragClient'",
  "import { buildAgentTraceHeaders } from '../../utils/agents/agentTrace'",
  `import { EntitiesSchema, ForceIntentSchema, IntentSchema, PlanSchema, RouteSchema, StepSchema, normalizeEntities, type ForceIntent, type Intent, type Step, type TaskPlan } from '../../utils/shared/taskPlan'`,
  `import {
  createRagRelevanceJudge,
  createRagEvidenceMatchJudge,
  createRagScopeHintJudge
} from '../../utils/rag/managerRagRelevance'`
]

const REPLACEMENT = `import {
  createManagerChatOpenAI,
  callAiAdminAgent,
  callCodeAgent,
  callCrawlerAgent,
  callLobsterAgent,
  callDbAgent,
  callMultimodalAgent,
  callMusicAgent,
  callVideoAgent,
  callRagAgent,
  fetchDbTaskPlan,
  ragProbeTimeoutMs,
  buildAgentTraceHeaders,
  EntitiesSchema,
  ForceIntentSchema,
  IntentSchema,
  PlanSchema,
  RouteSchema,
  StepSchema,
  normalizeEntities,
  type ForceIntent,
  type Intent,
  type Step,
  type TaskPlan,
  createRagRelevanceJudge,
  createRagEvidenceMatchJudge,
  createRagScopeHintJudge
} from './wireGraphUtilsDeps'`

const TARGETS = [
  'createManagerGraph.ts',
  'managerGraphRuntimeBundle.ts',
  'wire/wireExecGraphNodes.ts',
  'wire/wireFinalGraphNodes.ts',
  'wire/wireRouteGraphNodes.ts',
  'wireGraphRoutePhase.ts'
]

function stripBlock(content) {
  let next = content
  for (const line of IMPORT_BLOCK) {
    next = next.replace(line, '')
  }
  next = next.replace(/\n{3,}/g, '\n\n')
  return next
}

function hasBlock(content) {
  return IMPORT_BLOCK.every((line) => content.includes(line.split('\n')[0].slice(0, 40)))
}

const depsPath = path.join(stateDir, 'wireGraphUtilsDeps.ts')
if (!dryRun) fs.writeFileSync(depsPath, WIRE_UTILS_DEPS, 'utf8')
console.log('write:', path.relative(root, depsPath))

let changed = 0
for (const rel of TARGETS) {
  const file = path.join(stateDir, rel)
  if (!fs.existsSync(file)) {
    console.warn('skip missing:', rel)
    continue
  }
  const raw = fs.readFileSync(file, 'utf8')
  if (!hasBlock(raw) && !raw.includes("from '../../utils/chat/managerChatOpenAI'")) {
    console.warn('skip (no legacy block):', rel)
    continue
  }
  let next = stripBlock(raw)
  if (!next.includes("from './wireGraphUtilsDeps'") && !next.includes("from '../wireGraphUtilsDeps'")) {
    const importLine = rel.startsWith('wire/') ? REPLACEMENT.replace('./wireGraphUtilsDeps', '../wireGraphUtilsDeps') : REPLACEMENT
    next = next.replace(
      /import type \{ ChatOpenAI \} from '@langchain\/openai'\n/,
      `import type { ChatOpenAI } from '@langchain/openai'\n${importLine}\n`
    )
  }
  if (next !== raw) {
    changed++
    console.log('wire:', rel)
    if (!dryRun) fs.writeFileSync(file, next, 'utf8')
  }
}

console.log(`Done wire utils dedupe. changed=${changed}${dryRun ? ' (dry-run)' : ''}`)
