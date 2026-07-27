/**
 * Restore setup.ts from backup with correct paths and early-return shape.
 */
import fs from 'node:fs'
import path from 'node:path'

const bak = fs.readFileSync(path.join(process.cwd(), 'server/api/manager-ws/dispatchIncomingMessage.ts.bak'), 'utf8').split(/\r?\n/)

const importBlock = bak
  .slice(0, 86)
  .join('\n')
  .replaceAll("from '../../utils/", "from '../../../utils/")
  .replaceAll("from './schemas'", "from '../schemas'")
  .replaceAll("from './runtimeState'", "from '../runtimeState'")
  .replaceAll("from './wsSessionHelpers'", "from '../wsSessionHelpers'")

let body = bak.slice(97, 155).join('\n').replace(/^\s{6}/gm, '  ')
body = body.replace(/return\s*$/gm, 'return { ok: false, send }')

const content = `${importBlock}
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

${body}

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

fs.writeFileSync(path.join(process.cwd(), 'server/api/manager-ws/handlers/setup.ts'), content, 'utf8')
console.log('restore-ws-setup: ok')
