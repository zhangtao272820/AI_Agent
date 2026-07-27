/**
 * MCP JSON-RPC 2.0 轻量 helpers（各 Agent /api/mcp 共用）
 */

export type McpJsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export type McpToolDescriptor = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export function mcpOk(id: McpJsonRpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0' as const, id: id ?? null, result }
}

export function mcpErr(id: McpJsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } }
}

export function mcpTextResult(data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  return { content: [{ type: 'text' as const, text: text.slice(0, 120_000) }] }
}

export function parseMcpToolCallParams(params: Record<string, unknown> | undefined) {
  const name = String(params?.name ?? '').trim()
  const args = (params?.arguments ?? {}) as Record<string, unknown>
  return { name, args }
}

export function prefixToolName(serverName: string, toolName: string) {
  return `${serverName}__${toolName}`
}

export function splitPrefixedToolName(full: string): { serverName: string; toolName: string } | null {
  const i = full.indexOf('__')
  if (i <= 0) return null
  return { serverName: full.slice(0, i), toolName: full.slice(i + 2) }
}

export type McpToolStepRequest = {
  serverName: string
  toolName: string
  args?: Record<string, unknown>
  prefixedToolName?: string
}

export function parseMcpToolStepRequest(raw: unknown): McpToolStepRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const prefixed = String(r.prefixedToolName ?? r.tool ?? '').trim()
  if (prefixed) {
    const split = splitPrefixedToolName(prefixed)
    if (split) {
      return {
        serverName: split.serverName,
        toolName: split.toolName,
        args: (r.args ?? r.arguments) as Record<string, unknown> | undefined,
        prefixedToolName: prefixed,
      }
    }
  }
  const serverName = String(r.serverName ?? r.server ?? '').trim()
  const toolName = String(r.toolName ?? r.name ?? '').trim()
  if (!serverName || !toolName) return null
  return {
    serverName,
    toolName,
    args: (r.args ?? r.arguments) as Record<string, unknown> | undefined,
  }
}
