import type { Step } from '../../../utils/shared/taskPlan'
import type { RagRelevanceJudge, RagEvidenceMatchJudge, RagScopeHintJudge } from '../../../utils/rag/managerRagRelevance'
import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'

export type CreateMultiNodeDeps = {
  ensureNotAborted: () => void
  opts: any
  policyPromise: Promise<any>
  defaultPolicy: () => any
  getEffectivePlanSteps: (state: any) => Step[]
  normalizePlanSteps: (steps: Step[]) => Step[]
  buildStepContext: (
    step: Step,
    byId: Record<string, { id: string; agent: Step['agent']; query: string; output: string; status?: string; error?: string }>
  ) => string
  lastUserText: (messages: any[]) => string
  timeLeftMs: (resources: any) => number
  callDbAgent: (input: any) => Promise<any>
  callRagAgent: (input: any) => Promise<any>
  callCrawlerAgent: (input: any) => Promise<any>
  callLobsterAgent: (input: any) => Promise<any>
  callAiAdminAgent: (input: any) => Promise<any>
  callCodeAgent: (input: any) => Promise<any>
  callMultimodalAgent: (input: any) => Promise<any>
  callMusicAgent: (input: any) => Promise<any>
  callVideoAgent: (input: any) => Promise<any>
  runInternalAgent: (kind: 'clean' | 'visualize' | 'report', question: string, state: any, contextInput?: any) => Promise<any>
  parseRagClarifyPayload: (text: string) => { needsClarify: boolean; questions: string[] }
  parseCrawlerClarifyPayload: (raw: any) => { needsClarify: boolean; questions: string[] }
  probeRagEvidence: (query: string) => Promise<any>
  filterCrawlerResultDomestic: (obj: any) => any
  buildClarifyQuestions: (text: string, intent?: any, probe?: any) => string[]
  appendMetrics: (entry: any) => Promise<any>
  isDbNoData: (text: string) => boolean
  emitTrace: (entry: any) => void
  summarize: (text: string, max?: number) => string
  mergeMeta: (state: any, patch: any) => any
  mergeTaskPlan: (base: any, incoming: any, fallbackIntent: any, fallbackSteps: Step[]) => any
  ragRelevanceJudge: RagRelevanceJudge
  ragEvidenceMatchJudge?: RagEvidenceMatchJudge
  ragScopeHintJudge?: RagScopeHintJudge
  llmInvoke: LlmInvokeFn
}
