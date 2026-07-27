/**
 * P2-A：通用 MCP 工具步执行器（供 mcp_tool_node / 编排直调）
 */
import { callManagerMcpTool } from '../../../utils/mcp/managerMcpHost'
import { parseMcpToolStepRequest, type McpToolStepRequest } from '#agent-shared/mcpJsonRpc'
import { extractStructuredPayload } from '../shared'
import type { AgentStepOutcome } from './types'

export type { McpToolStepRequest }
export { parseMcpToolStepRequest }

export async function executeMcpToolStep(input: {
  request: McpToolStepRequest
  query?: string
  sendThinking?: (t: string) => void
}): Promise<AgentStepOutcome> {
  const { request } = input
  input.sendThinking?.(`MCP 工具：${request.serverName}/${request.toolName}…`)
  try {
    const out = await callManagerMcpTool({
      serverName: request.serverName,
      toolName: request.toolName,
      args: request.args,
    })
    return {
      ok: out.ok,
      agent: 'mcp',
      output: out.text,
      query: input.query ?? '',
      parsed: extractStructuredPayload(out.text),
      evidence: {
        kind: 'mcp',
        server: request.serverName,
        tool: request.toolName,
        transport: 'mcp',
      },
      rawResult: out.raw,
    }
  } catch (e: unknown) {
    const err = String((e as Error)?.message || e || 'unknown error')
    return {
      ok: false,
      agent: 'mcp',
      output: `MCP 工具失败：${err}`,
      query: input.query ?? '',
      error: err,
    }
  }
}
