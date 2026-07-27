import {
  isManagerWsAuthEnabled,
  tryAuthenticateWsPeer
} from '../graph/core/runtime/wsAuth'
import { unregisterWsSessionPeer } from '../graph/core/runtime/wsSessionHub'
import { peerUnregister } from './manager-ws/runtimeState'
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
