import type { z } from 'zod'
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
