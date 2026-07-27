/**
 * B1: Split dispatchIncomingMessage.ts into handler modules.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const src = path.join(root, 'server/api/manager-ws/dispatchIncomingMessage.ts')
const handlersDir = path.join(root, 'server/api/manager-ws/handlers')

const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/)

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n')
}

const importBlock = slice(1, 86).trim()

const handlerRanges = [
  ['handleResume', 'resume', 157, 185],
  ['handleClearExperience', 'clear_experience', 186, 195],
  ['handleRouteFeedback', 'route_feedback', 196, 262],
  ['handleFeedback', 'feedback', 263, 363],
  ['handleWithdrawTurn', 'withdraw_turn', 364, 394],
  ['handleCancel', 'cancel', 395, 417],
  ['handlePlanConfirm', 'plan_confirm', 419, 445],
  ['handleHumanConfirm', 'human_confirm', 447, 660],
  ['handleChat', 'chat', 662, 920]
]

fs.mkdirSync(handlersDir, { recursive: true })

const typesTs = `import type { z } from 'zod'
import type { IncomingMessageSchema } from '../schemas'

export type WsSendFn = (event: string, data?: unknown, from?: string, runId?: string) => void

export type ParsedWsMessage = z.infer<typeof IncomingMessageSchema>

export type WsHandlerContext = {
  peer: any
  peerKey: string
  send: WsSendFn
  sessionId: string
  boundUserId: string | null
  tenantId?: string
  explicitUserId?: string
  platformTraceId?: string
  payloadRaw: Record<string, unknown>
}
`
fs.writeFileSync(path.join(handlersDir, 'types.ts'), typesTs)

const setupBody = slice(98, 155)
  .replace(/^\s{6}/gm, '')
  .trim()

const setupTs = `${importBlock}
import { IncomingMessageSchema } from '../schemas'
import type { WsHandlerContext, WsSendFn } from './types'

export type WsSetupResult =
  | { ok: false; send: WsSendFn }
  | { ok: true; ctx: WsHandlerContext; type: string; payload: import('./types').ParsedWsMessage }

export async function setupWsMessage(peer: any, message: any): Promise<WsSetupResult> {
  cleanupMaps()
  const send: WsSendFn = (event, data, from, runId) => {
    try {
      peer.send(JSON.stringify({ event, data, from, runId }))
    } catch {}
    if (runId) void appendRunEvent(runId, { event, data, from, ts: new Date().toISOString() })
  }

${setupBody}

  return {
    ok: true,
    ctx: {
      peer,
      peerKey,
      send,
      sessionId,
      boundUserId,
      tenantId,
      explicitUserId,
      platformTraceId,
      payloadRaw: payloadRaw as Record<string, unknown>
    },
    type,
    payload
  }
}
`
fs.writeFileSync(path.join(handlersDir, 'setup.ts'), setupTs)

for (const [fnName, typeKey, start, end] of handlerRanges) {
  let body = slice(start, end)
    .replace(/^\s{6}if \(type === '[^']+'\) \{\r?\n/, '')
    .replace(/^\s{6}/gm, '  ')
    .replace(/\n\s{6}return\s*$/, '\n')
    .replace(/\}\s*$/, '')
    .trim()

  if (typeKey === 'chat') {
    body = body.replace(/^if \(!allowRate/, 'if (!allowRate')
  }

  const file = `${importBlock}
import type { WsHandlerContext, ParsedWsMessage } from './types'

export async function ${fnName}(ctx: WsHandlerContext, payload: ParsedWsMessage) {
  const { peer, peerKey, send, sessionId, boundUserId, tenantId, explicitUserId, platformTraceId, payloadRaw } = ctx

${body}
}
`
  fs.writeFileSync(path.join(handlersDir, `${fnName}.ts`), file)
}

const registryTs = `import type { WsHandlerContext, ParsedWsMessage } from './types'
import { handleResume } from './handleResume'
import { handleClearExperience } from './handleClearExperience'
import { handleRouteFeedback } from './handleRouteFeedback'
import { handleFeedback } from './handleFeedback'
import { handleWithdrawTurn } from './handleWithdrawTurn'
import { handleCancel } from './handleCancel'
import { handlePlanConfirm } from './handlePlanConfirm'
import { handleHumanConfirm } from './handleHumanConfirm'
import { handleChat } from './handleChat'

export type WsHandlerFn = (ctx: WsHandlerContext, payload: ParsedWsMessage) => Promise<void>

export const WS_MESSAGE_HANDLERS: Record<string, WsHandlerFn> = {
  resume: handleResume,
  clear_experience: handleClearExperience,
  route_feedback: handleRouteFeedback,
  feedback: handleFeedback,
  withdraw_turn: handleWithdrawTurn,
  cancel: handleCancel,
  plan_confirm: handlePlanConfirm,
  human_confirm: handleHumanConfirm
}

export async function dispatchWsByType(ctx: WsHandlerContext, type: string, payload: ParsedWsMessage) {
  const handler = WS_MESSAGE_HANDLERS[type] ?? handleChat
  await handler(ctx, payload)
}
`
fs.writeFileSync(path.join(handlersDir, 'registry.ts'), registryTs)

const dispatchTs = `import { setupWsMessage } from './handlers/setup'
import { dispatchWsByType } from './handlers/registry'

export async function dispatchIncomingMessage(peer: any, message: any) {
  const setup = await setupWsMessage(peer, message)
  if (!setup.ok) {
    setup.send('error', '消息格式或鉴权失败', 'manager')
    return
  }
  await dispatchWsByType(setup.ctx, setup.type, setup.payload)
}
`
fs.writeFileSync(src, dispatchTs)

console.log('split-ws-handlers: created', handlerRanges.length, 'handlers + setup + registry')
