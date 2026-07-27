/**
 * B1: Extract WS message handler body from manager-ws.ts → dispatchIncomingMessage.ts
 */
import fs from 'node:fs'
import path from 'node:path'

const wsPath = path.join(process.cwd(), 'server/api/manager-ws.ts')
const dispatchPath = path.join(process.cwd(), 'server/api/manager-ws/dispatchIncomingMessage.ts')

const src = fs.readFileSync(wsPath, 'utf8')
const handlerStart = src.indexOf('  async message(peer, message) {')
const handlerEnd = src.lastIndexOf('  },\n\n  close(peer)')
if (handlerStart < 0 || handlerEnd < 0) throw new Error('Could not locate message handler')

const importsEnd = src.indexOf('\n\nexport default defineWebSocketHandler')
const imports = src.slice(0, importsEnd).trim()

const bodyInner = src.slice(handlerStart + '  async message(peer, message) {'.length, handlerEnd).trim()

const extraImports = `
import { RunIdSchema } from './schemas'
import { nowMs } from './runtimeState'
import { withAgentTraceContext } from '../../utils/agents/agentTrace'
`

const dispatchFile = `${imports}
${extraImports}

export async function dispatchIncomingMessage(peer: any, message: any) {
${bodyInner.split('\n').map((line) => (line ? `  ${line}` : line)).join('\n')}
}
`

fs.writeFileSync(dispatchPath, dispatchFile)

const newWs = `${imports}

import { dispatchIncomingMessage } from './manager-ws/dispatchIncomingMessage'

export default defineWebSocketHandler({
  open(peer) {
    try {
      if (isManagerWsAuthEnabled()) {
        const verdict = tryAuthenticateWsPeer(peer)
        if (!verdict.ok) {
          peer.send(JSON.stringify({ event: 'error', data: verdict.reason, from: 'manager' }))
          try {
            peer.close(4401, 'unauthorized')
          } catch {}
          return
        }
      }
      peer.send(JSON.stringify({ event: 'status', data: 'open', from: 'manager' }))
    } catch {}
  },

  async message(peer, message) {
    await dispatchIncomingMessage(peer, message)
  },

  close(peer) {
    try {
      peerUnregister.get(peer)?.()
      peerUnregister.delete(peer)
      unregisterWsSessionPeer(String((peer as any)?.id || ''))
    } catch {}
  }
})
`

fs.writeFileSync(wsPath, newWs)
console.log('split-ws-dispatch: ok', dispatchPath)
