import type { ChatOpenAI } from '@langchain/openai'
import { createManagerRuntime } from '../../core/runtime/runtime'
import { lastUserText } from '../../core/text'
import { defaultPolicy } from '../../core/shared'
import { appendMemory, appendMetrics } from '../../core/runtime/runtimePersistence'
import { buildClarifyQuestions } from '../graphFactoryHelpers'
import { FixStrategySchema } from '../graphAnnotation'
import type { ManagerGraphRuntimeBundle } from '../runtimeBundle'

export type WireGraphNodesCtx = {
  opts: Record<string, any>
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
}
