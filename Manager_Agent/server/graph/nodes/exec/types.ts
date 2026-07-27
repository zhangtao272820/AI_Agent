import type { Intent } from '../../../utils/shared/taskPlan'
import type { RagRelevanceJudge, RagEvidenceMatchJudge, RagScopeHintJudge } from '../../../utils/rag/managerRagRelevance'
import type { LlmInvokeFn } from '../../llm/taskConstraintsLlm'

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
  mergeTaskPlan: (base: any, incoming: any, fallbackIntent: Intent, fallbackSteps: any[]) => any
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
  ragRelevanceJudge: RagRelevanceJudge
  ragEvidenceMatchJudge?: RagEvidenceMatchJudge
  ragScopeHintJudge?: RagScopeHintJudge
  llmInvoke: LlmInvokeFn
}
