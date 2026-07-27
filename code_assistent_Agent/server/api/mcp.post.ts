import { handleCodeAssistMcpRequest } from '../mcp/codeAssistMcpHandler'
import { ensureInternalAgentAccess } from '../utils/internal_auth'

export default defineEventHandler(async (event) => {
  ensureInternalAgentAccess(event)
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}))
  return await handleCodeAssistMcpRequest(body as any)
})
