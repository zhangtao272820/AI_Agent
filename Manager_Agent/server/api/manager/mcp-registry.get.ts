import { loadMcpToolRegistry } from '#agent-shared/mcpToolRegistry'

export default defineEventHandler(async () => {
  const tools = await loadMcpToolRegistry()
  return {
    ok: true,
    count: tools.length,
    tools
  }
})
