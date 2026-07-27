import { parseManagerTaskEnvelope } from '#agent-shared/managerTaskEnvelope'
import { parseMcpToolStepRequest, type McpToolStepRequest } from '#agent-shared/mcpJsonRpc'

export function isManagerMcpToolNodeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_MCP_TOOL_NODE ?? '1').trim() !== '0'
}

export function resolveMcpDirectCallFromMeta(meta: unknown): McpToolStepRequest | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  const direct = m.mcpDirectCall ?? m.mcpToolCall
  const parsed = parseMcpToolStepRequest(direct)
  if (parsed) return parsed

  const envelopeRaw = m.managerTaskEnvelope ?? m.manager_task_envelope_v2
  const envelope = parseManagerTaskEnvelope(
    typeof envelopeRaw === 'string' || (envelopeRaw && typeof envelopeRaw === 'object')
      ? (envelopeRaw as string | Record<string, unknown>)
      : null,
  )
  const mcp = envelope?.mcp
  if (mcp?.server && mcp.tool) {
    return {
      serverName: String(mcp.server).trim(),
      toolName: String(mcp.tool).trim(),
      args: (mcp.arguments ?? {}) as Record<string, unknown>,
    }
  }
  return null
}
