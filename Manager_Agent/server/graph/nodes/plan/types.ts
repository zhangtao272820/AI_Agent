import type { Step } from '../../../utils/shared/taskPlan'
import type { TaskConstraints } from '../../core/plan'

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
