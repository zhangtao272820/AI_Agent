import type { TaskConstraints } from '../../core/plan'
import type { ExecutableAgent } from '../../core/routing/routeFinalize'

export type CreateRouterNodeDeps = {
  policyDir: string
  sessionId?: string
  runId?: string
  userId?: string
  opts: { sendEvent: (event: { event: string; data?: any; from?: string }) => void }
  policyPromise: Promise<any>
  defaultPolicy: () => any
  lastUserText: (messages: any[]) => string
  isExplicitMultiRequest: (text: string) => boolean
  shouldPreferMulti: (text: string, probe?: any) => boolean
  needsDataFoundation: (text: string) => boolean
  RouteSchema: any
  llmInvoke: (stage: 'route' | 'plan' | 'synth' | 'critic', state: any, messages: any[]) => Promise<{ text: string; resources: any; meta: any }>
  mergeMeta: (state: any, patch: Record<string, any>) => Record<string, any>
  safeJsonParse: (text: string) => any
  summarize: (text: string, max?: number) => string
  appendConstraintsToQuery: (query: string, constraints: TaskConstraints) => string
  uncertaintyFromConfidence: (confidence: number) => 'low' | 'medium' | 'high'
  normalizeEntities: (v: any) => any
}
