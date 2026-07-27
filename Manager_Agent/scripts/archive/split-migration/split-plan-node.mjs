/**
 * B5: Split managerGraph.planNode.ts → server/graph/nodes/plan/
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcPath = path.join(root, 'server/graph/nodes/managerGraph.planNode.ts')
const outDir = path.join(root, 'server/graph/nodes/plan')
const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/)
const importBlock = lines.slice(0, 57).join('\n')

fs.mkdirSync(outDir, { recursive: true })

const helpers = `${importBlock}

export const PLANNER_RULES_FALLBACK =
  '你是 Planner：为 multi 任务输出 steps JSON；遵守 dependsOn/parallelGroup；allowedAgents 为白名单 cap，只规划用户真正需要的步骤；硬规则：visualize/report 需 code，多源对比需 clean'

export function stripAdminStepsIfBlocked(plan: any[], state: { meta?: unknown }) {
  if (!isAdminBlockedForState(state)) return plan
  return plan.filter((s) => String(s?.agent || '') !== 'admin')
}
`

const types = `import type { Step } from '../../../utils/taskPlan'
import type { TaskConstraints } from '../../core/managerGraph.plan'

export type CreatePlanNodeDeps = {
  ensureNotAborted: () => void
  policyDir?: string
  sessionId?: string
  userId?: string
  runId?: string
  opts: {
    sendEvent: (event: { event: string; data?: any; from?: string }) => void
    dbAgentHttpUrl: string
    timeoutMs: number
    dbId?: string
  }
  lastUserText: (messages: any[]) => string
  enforcePlanConstraints: (plan: any[], constraints: TaskConstraints) => any[]
  buildTaskPlan: (state: any, plan: any[]) => any
  appendMemory: (entry: { user: string } & Record<string, any>) => Promise<void>
  needsDataFoundation: (text: string) => boolean
  fetchDbTaskPlan: (args: {
    state: any
    question: string
    sendEvent: (event: { event: string; data?: any; from?: string }) => void
    runId?: string
  }) => Promise<void>
  mergeTaskPlan: (base: any, incoming: any, fallbackIntent: any, fallbackSteps: Step[]) => any
  llmInvoke: (stage: string, state: any, messages: any[], options?: any) => Promise<any>
  PlanSchema: any
  safeJsonParse: (text: string) => any
  enforcePlanCoverage: (plan: Step[], state: any) => Step[]
  getPlanQualityHint: (state: any) => string | null
  recordPlanOutcome: (args: {
    dir: string
    sessionId?: string
    userId?: string
    runId?: string
  }) => Promise<void>
  runId?: string
}
`

const createBody = lines.slice(108).join('\n')
const createPlanNode = `${importBlock}
import { PLANNER_RULES_FALLBACK, stripAdminStepsIfBlocked } from './helpers'
import type { CreatePlanNodeDeps } from './types'

${createBody}
`

fs.writeFileSync(path.join(outDir, 'helpers.ts'), helpers)
fs.writeFileSync(path.join(outDir, 'types.ts'), types)
fs.writeFileSync(path.join(outDir, 'createPlanNode.ts'), createPlanNode)
fs.writeFileSync(
  path.join(outDir, 'index.ts'),
  `export { createPlanNode, type CreatePlanNodeDeps } from './createPlanNode'\nexport { PLANNER_RULES_FALLBACK, stripAdminStepsIfBlocked } from './helpers'\n`
)

fs.writeFileSync(srcPath, `/** B5: plan node split — re-export shim */\nexport { createPlanNode, type CreatePlanNodeDeps } from './plan'\n`)

console.log('split-plan-node: server/graph/nodes/plan/ created')
