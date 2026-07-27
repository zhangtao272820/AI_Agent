/**
 * Slim WS handlers: shared barrel + minimal handler imports.
 */
import fs from 'node:fs'
import path from 'node:path'

const handlersDir = path.join(process.cwd(), 'server/api/manager-ws/handlers')

const barrel = `/** B1: shared WS handler barrel — single import source */
export { HumanMessage } from '@langchain/core/messages'
export { default as crypto } from 'node:crypto'
export { default as fs } from 'node:fs/promises'
export { default as path } from 'node:path'
export { buildGraphHistoryMessages } from '../server/graph/core/runtime/conversationBudget'
export { buildSummarizeWithLlmFn } from '../../../utils/session/managerConversationLlmSummary'
export { createManagerGraph } from '../server/graph/state/graphEntry'
export { buildManagerGraphInvokeConfig, buildManagerTurnInvokeState } from '../server/graph/state/invokeConfig'
export {
  composeFinalFromGraphResult,
  buildHumanConfirmCheckpoint,
  pickRicherFinalText
} from '../server/graph/core/output/composeFinal'
export {
  deleteHumanConfirmCheckpoint,
  loadHumanConfirmCheckpoint,
  saveHumanConfirmCheckpoint
} from '../server/graph/core/runtime/checkpointStore'
export { isSynthRejectingMedia } from '../server/graph/core/shared'
export { loadTaskStack } from '../server/graph/core/task/taskStack'
export { detectClarifyFollowUp, clarifyReplanMetaPatch } from '../server/graph/core/plan/clarifyReplan'
export {
  drainPendingAutonomousResults,
  isAutonomousWsNotifyEnabled
} from '../server/graph/core/task/autonomousNotify'
export { registerWsSessionPeer, unregisterWsSessionPeer } from '../server/graph/core/runtime/wsSessionHub'
export {
  isManagerWsAuthEnabled,
  isWsPeerAuthed,
  markWsPeerAuthed,
  peerRequestMeta,
  validateManagerWsAuth
} from '../server/graph/core/runtime/wsAuth'
export { getPendingProactiveNudges, isProactiveLoopEnabled } from '../server/graph/core/task/proactiveLoop'
export { normalizeFeedbackScore } from '../server/graph/core/runtime/runtimePersistence'
export { maybeTuneLearningWeights, patchLearningSignalWithFeedback } from '../server/graph/core/unifiedLearning/record'
export { resolveAgentEndpointsWithPlatform } from '../../../utils/platform/agentPlatformSync'
export { resolveManagerLlmConfig } from '../../../utils/platform/platformConfigRuntime'
export { resolveGuiConfirm, cancelGuiConfirmsForRun } from '../../../utils/gui/guiConfirmBridge'
export { resolvePlanConfirm, cancelPlanConfirmsForRun } from '../../../utils/shared/planConfirmBridge'
export { RunIdSchema } from '../schemas'
export {
  allowRate,
  isRunAbortError,
  peerUnregister,
  runMeta,
  runs,
  sessionMeta,
  sessions,
  touchSession,
  nowMs
} from '../runtimeState'
export {
  appendRunEvent,
  buildRagHistoryForRun,
  buildUserContent,
  emitAdminHumanConfirmRequest,
  emitImplicitLearning,
  emitRunObservability,
  ensureUserBinding,
  graphAgentEndpoints,
  ingestTaskStackFromUserMessage,
  isHumanConfirmClarification,
  pauseAdminConfirmMessage,
  policyDataDir,
  pruneAutoUserTasksOnEditResend,
  readSession,
  resolveUserMessageSessionIndex,
  sanitizeHistoryText,
  stripAttachmentSuffix,
  writeSession
} from '../wsSessionHelpers'
export { withAgentTraceContext } from '../../../utils/agents/agentTrace'
export { useRuntimeConfig } from '#imports'
`

fs.writeFileSync(path.join(handlersDir, 'wsBarrel.ts'), barrel)

const perHandlerImports = {
  handleResume: `import { path, readSession, sessions, send, getPendingProactiveNudges, isProactiveLoopEnabled, drainPendingAutonomousResults, isAutonomousWsNotifyEnabled } from './wsBarrel'`,
  handleClearExperience: `import { send } from './wsBarrel'`,
  handleRouteFeedback: `import { send } from './wsBarrel'`,
  handleFeedback: `import { fs, path, normalizeFeedbackScore, patchLearningSignalWithFeedback, maybeTuneLearningWeights, send } from './wsBarrel'`,
  handleWithdrawTurn: `import { readSession, sessions, writeSession, resolveUserMessageSessionIndex, send } from './wsBarrel'`,
  handleCancel: `import { runs, runMeta, sessionMeta, cancelGuiConfirmsForRun, cancelPlanConfirmsForRun, emitImplicitLearning, isRunAbortError, send } from './wsBarrel'`,
  handlePlanConfirm: `import { resolvePlanConfirm, send } from './wsBarrel'`,
  handleHumanConfirm: `import { HumanMessage, crypto, RunIdSchema, createManagerGraph, buildManagerGraphInvokeConfig, composeFinalFromGraphResult, pickRicherFinalText, deleteHumanConfirmCheckpoint, loadHumanConfirmCheckpoint, isSynthRejectingMedia, resolveManagerLlmConfig, resolveAgentEndpointsWithPlatform, buildGraphHistoryMessages, buildSummarizeWithLlmFn, graphAgentEndpoints, buildRagHistoryForRun, sanitizeHistoryText, withAgentTraceContext, emitRunObservability, emitImplicitLearning, loadTaskStack, path, runs, runMeta, sessionMeta, sessions, readSession, writeSession, nowMs, isRunAbortError, send } from './wsBarrel'`,
  handleChat: `import { crypto, RunIdSchema, createManagerGraph, buildManagerGraphInvokeConfig, buildManagerTurnInvokeState, composeFinalFromGraphResult, buildHumanConfirmCheckpoint, pickRicherFinalText, saveHumanConfirmCheckpoint, isSynthRejectingMedia, resolveManagerLlmConfig, resolveAgentEndpointsWithPlatform, buildGraphHistoryMessages, buildSummarizeWithLlmFn, graphAgentEndpoints, buildRagHistoryForRun, sanitizeHistoryText, detectClarifyFollowUp, clarifyReplanMetaPatch, ingestTaskStackFromUserMessage, withAgentTraceContext, emitRunObservability, emitAdminHumanConfirmRequest, isHumanConfirmClarification, pauseAdminConfirmMessage, loadTaskStack, path, runs, runMeta, sessionMeta, sessions, readSession, writeSession, buildUserContent, stripAttachmentSuffix, resolveUserMessageSessionIndex, pruneAutoUserTasksOnEditResend, policyDataDir, emitImplicitLearning, allowRate, nowMs, isRunAbortError, useRuntimeConfig, send } from './wsBarrel'`
}

for (const [file, imp] of Object.entries(perHandlerImports)) {
  const p = path.join(handlersDir, file + '.ts')
  if (!fs.existsSync(p)) continue
  const content = fs.readFileSync(p, 'utf8')
  const fnMatch = content.match(/export async function (\w+)/)
  if (!fnMatch) continue
  const fnName = fnMatch[1]
  const bodyStart = content.indexOf(`const { peer`)
  const body = content.slice(bodyStart)
  const slim = `import type { WsHandlerContext, ParsedWsMessage } from './types'
${imp}

export async function ${fnName}(ctx: WsHandlerContext, payload: ParsedWsMessage) {
  ${body}`
  fs.writeFileSync(p, slim, 'utf8')
}

console.log('slim-ws-handlers-v2: ok')
