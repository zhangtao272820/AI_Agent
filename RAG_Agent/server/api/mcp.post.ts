import { handleRagMcpRequest } from '../mcp/ragMcpHandler'
import { ensureInternalAgentAccess } from '../utils/internal_auth'
import { applyPlatformModelOverrides } from '../utils/platform_config'

export default defineEventHandler(async (event) => {
  ensureInternalAgentAccess(event)
  await applyPlatformModelOverrides({})
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}))
  return await handleRagMcpRequest(body as any)
})
