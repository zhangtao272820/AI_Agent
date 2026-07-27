import { handleExtractorMcpRequest } from '../mcp/extractorMcpHandler'
import { ensureInternalAgentAccess } from '../utils/internal_auth'
import { applyPlatformRuntimeOverrides } from '../utils/platform_config'

export default defineEventHandler(async (event) => {
  ensureInternalAgentAccess(event)
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}))
  const cfg = await applyPlatformRuntimeOverrides(useRuntimeConfig(event) as any)
  const res = await handleExtractorMcpRequest(body as any, cfg)
  return res
})
