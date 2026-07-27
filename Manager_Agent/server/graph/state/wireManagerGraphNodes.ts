import type { ChatOpenAI } from '@langchain/openai'
import { createManagerRuntime } from '../core/runtime/runtime'
import type { ManagerGraphRuntimeBundle } from './runtimeBundle'
import { wireGraphRoutePhase } from './wireGraphRoutePhase'
import { wireGraphExecPhase } from './wireGraphExecPhase'

export type WiredManagerGraphNodes = ReturnType<typeof wireManagerGraphNodes>

export function wireManagerGraphNodes(ctx: {
  opts: Record<string, any>
  policyDir: string
  ensureNotAborted: () => void
  mergeMeta: (state: any, patch: Record<string, any>) => any
  mergeResources: (state: any, patch: Partial<any>) => any
  llmInvoke: ReturnType<typeof createManagerRuntime>['llmInvoke']
  lastUserText: (messages: any, routedQuery?: string) => string
  fetchJson: (url: string, body: any, timeoutMs: number) => Promise<any>
  policyPromise: Promise<any>
  defaultPolicy: () => any
  appendMemory: (entry: any) => Promise<void>
  appendMetrics: (entry: any) => Promise<void>
  safeJsonParse: (text: string) => unknown
  percentile: (arr: number[], p: number) => number
  summarize: (text: string, max?: number) => string
  emitTrace: (data: any, from?: string) => void
  probeRagEvidence: (query: string) => Promise<any>
  ragEvidenceFromProbe: (query: string, probe: any) => any
  runInternalAgent: ManagerGraphRuntimeBundle['runInternalAgent']
  runAlwaysInternalCollaborators: ManagerGraphRuntimeBundle['runAlwaysInternalCollaborators']
  formatReferences: ManagerGraphRuntimeBundle['formatReferences']
  redactSecrets: ManagerGraphRuntimeBundle['redactSecrets']
  timeLeftMs: (resources: any) => number
  buildClarifyQuestions: (ctx: any) => string[]
  FixStrategySchema: { parse: (v: unknown) => any }
  getModel: (modelName: string, temperature?: number) => ChatOpenAI
  traceRun: <T>(name: string, fn: () => Promise<T>, extra?: Record<string, any>) => Promise<T>
}) {
  const route = wireGraphRoutePhase(ctx)
  const exec = wireGraphExecPhase(ctx, route)
  return { ...route, ...exec }
}
