import { setupWsMessage } from './handlers/setup'
import { dispatchWsByType } from './handlers/registry'

export async function dispatchIncomingMessage(peer: any, message: any) {
  const setup = await setupWsMessage(peer, message)
  if (!setup.ok) return
  await dispatchWsByType(setup.ctx, setup.type, setup.payload)
}
