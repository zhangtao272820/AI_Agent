import { handleLobsterGuiMcpRequest } from '../mcp/lobsterGuiMcpHandler'
import { ensureInternalAgentAccess } from '../utils/internal_auth'

export default defineEventHandler(async (event) => {
  ensureInternalAgentAccess(event)
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}))
  const cfg = useRuntimeConfig() as Record<string, unknown>
  return await handleLobsterGuiMcpRequest(body as any, cfg)
})
