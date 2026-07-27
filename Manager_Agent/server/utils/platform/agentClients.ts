/**
 * 子 Agent HTTP/WS 客户端 — 按域拆分在 ./agents/ 下，此文件仅做统一导出以保持既有 import 路径。
 */
export type {
  AgentResult,
  AgentSource,
  ChatMessage,
  CodeAgentMeta,
  CodeAgentResult,
  DbResult,
  RagEvidence,
  RagHistoryMessage
} from '../agents/types'

export { buildAgentTraceHeaders, isManagerAgentTraceEnabled, isManagerStreamDeltaEnabled, resolveTraceId, withTraceBody } from '../agents/agentTrace'
export {
  wrapCodeResult,
  wrapDbResult,
  wrapRagAnswer,
  wrapAdminResult,
  wrapMultimodalResult,
  wrapMediaAgentResult,
  wrapGuiResult,
  unwrapAgentCall,
  formatAgentResultSourcesForSynth,
  type AgentCallResult
} from '../agents/agentResult'

export { probeDb, fetchDbTaskPlan, callDbAgent } from '../agents/dbClient'

export { listRagDocs, callRagAgent, callRagRetrieve, type RagRetrieveResponse } from '../agents/ragClient'

export { isCodeRetrieveFirstEnabled, callCodeRetrieve, callCodeAgent } from '../agents/codeClient'

export { callCrawlerAgent } from '../agents/crawlerClient'

export { callLobsterAgent } from '../agents/lobsterClient'

export { callAiAdminAgent, callAiAdminPendingDecide } from '../agents/adminClient'

export { callMultimodalAgent, callMusicAgent, callVideoAgent } from '../agents/mediaClient'
