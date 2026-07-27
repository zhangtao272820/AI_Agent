/**
 * Slim WS handlers: shared imports + per-handler bodies only.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const handlersDir = path.join(root, 'server/api/manager-ws/handlers')
const bakCandidates = [
  path.join(root, 'server/api/manager-ws/dispatchIncomingMessage.ts.bak'),
  path.join(handlersDir, 'handleChat.ts')
]

const sharedHeader = `/** Shared WS handler imports (B1 slim) */
import { HumanMessage } from '@langchain/core/messages'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildGraphHistoryMessages } from '../server/graph/core/runtime/conversationBudget'
import { buildSummarizeWithLlmFn } from '../../../utils/session/managerConversationLlmSummary'
import { createManagerGraph } from '../server/graph/state/graphEntry'
import { buildManagerGraphInvokeConfig, buildManagerTurnInvokeState } from '../server/graph/state/invokeConfig'
import {
  composeFinalFromGraphResult,
  buildHumanConfirmCheckpoint,
  pickRicherFinalText
} from '../server/graph/core/output/composeFinal'
import {
  deleteHumanConfirmCheckpoint,
  loadHumanConfirmCheckpoint,
  saveHumanConfirmCheckpoint
} from '../server/graph/core/runtime/checkpointStore'
import { isSynthRejectingMedia } from '../server/graph/core/shared'
import { loadTaskStack } from '../server/graph/core/task/taskStack'
import { detectClarifyFollowUp, clarifyReplanMetaPatch } from '../server/graph/core/plan/clarifyReplan'
import {
  drainPendingAutonomousResults,
  isAutonomousWsNotifyEnabled
} from '../server/graph/core/task/autonomousNotify'
import {
  registerWsSessionPeer,
  unregisterWsSessionPeer
} from '../server/graph/core/runtime/wsSessionHub'
import {
  isManagerWsAuthEnabled,
  isWsPeerAuthed,
  markWsPeerAuthed,
  peerRequestMeta,
  validateManagerWsAuth
} from '../server/graph/core/runtime/wsAuth'
import { getPendingProactiveNudges, isProactiveLoopEnabled } from '../server/graph/core/task/proactiveLoop'
import { normalizeFeedbackScore } from '../server/graph/core/runtime/runtimePersistence'
import {
  maybeTuneLearningWeights,
  patchLearningSignalWithFeedback
} from '../server/graph/core/unifiedLearning/record'
import { resolveAgentEndpointsWithPlatform } from '../../../utils/platform/agentPlatformSync'
import { resolveManagerLlmConfig } from '../../../utils/platform/platformConfigRuntime'
import { resolveGuiConfirm, cancelGuiConfirmsForRun } from '../../../utils/gui/guiConfirmBridge'
import { resolvePlanConfirm, cancelPlanConfirmsForRun } from '../../../utils/shared/planConfirmBridge'
import { IncomingMessageSchema, RunIdSchema } from '../schemas'
import {
  allowRate,
  cleanupMaps,
  isRunAbortError,
  peerUnregister,
  runMeta,
  runs,
  sessionMeta,
  sessions,
  touchSession,
  nowMs
} from '../runtimeState'
import {
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
import { withAgentTraceContext } from '../../../utils/agents/agentTrace'
`

fs.writeFileSync(path.join(handlersDir, 'wsSharedImports.ts'), sharedHeader)

const handlerFiles = fs.readdirSync(handlersDir).filter((f) => f.startsWith('handle') && f.endsWith('.ts'))

for (const file of handlerFiles) {
  const p = path.join(handlersDir, file)
  const content = fs.readFileSync(p, 'utf8')
  const fnMatch = content.match(/export async function (\w+)\(/)
  if (!fnMatch) continue
  const fnName = fnMatch[1]
  const bodyStart = content.indexOf(`export async function ${fnName}`)
  const bodyOpen = content.indexOf('{', bodyStart)
  const body = content.slice(bodyOpen + 1).replace(/\}\s*$/, '').trim()
  const slim = `import type { WsHandlerContext, ParsedWsMessage } from './types'
import './wsSharedImports'

export async function ${fnName}(ctx: WsHandlerContext, payload: ParsedWsMessage) {
  const { peer, peerKey, send, sessionId, boundUserId, tenantId, explicitUserId, platformTraceId, payloadRaw } = ctx

${body}
}
`
  fs.writeFileSync(p, slim, 'utf8')
}

// setup.ts — keep explicit imports (slightly slimmer)
const setupPath = path.join(handlersDir, 'setup.ts')
if (fs.existsSync(setupPath)) {
  let setup = fs.readFileSync(setupPath, 'utf8')
  setup = setup.replace(/^import[\s\S]*?import type \{ WsHandlerContext/, "import type { WsHandlerContext")
  if (!setup.includes("from '../schemas'")) {
    setup = `import { IncomingMessageSchema } from '../schemas'
import {
  allowRate,
  cleanupMaps,
  peerUnregister,
  sessions,
  touchSession
} from '../runtimeState'
import { appendRunEvent, ensureUserBinding } from '../wsSessionHelpers'
import {
  isManagerWsAuthEnabled,
  isWsPeerAuthed,
  markWsPeerAuthed,
  peerRequestMeta,
  validateManagerWsAuth
} from '../server/graph/core/runtime/wsAuth'
import { registerWsSessionPeer } from '../server/graph/core/runtime/wsSessionHub'
${setup}`
  }
  fs.writeFileSync(setupPath, setup, 'utf8')
}

console.log(`slim-ws-handlers: ${handlerFiles.length} handlers + wsSharedImports.ts`)
