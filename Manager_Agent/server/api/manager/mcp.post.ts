import { handleManagerMcpRequest, isManagerMcpEnabled } from '../../utils/mcp/managerMcpHost'

export default defineEventHandler(async (event) => {
  if (!isManagerMcpEnabled()) {
    throw createError({ statusCode: 404, statusMessage: 'Manager MCP Host disabled' })
  }
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}))
  return await handleManagerMcpRequest(body as any)
})
