/**
 * P2-A MCP-first + mcpTool 结构 smoke（无网络）
 */
import { CODE_ASSIST_MCP_TOOLS } from '../../../../code_assistent_Agent/server/mcp/codeAssistMcpSchema'
import { parseMcpToolStepRequest } from '#agent-shared/mcpJsonRpc'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function isEnvFlagOn(name: string, env: NodeJS.ProcessEnv = process.env) {
  return String(env[name] ?? '0').trim() === '1'
}

process.env.MANAGER_GUI_MCP_FIRST = '1'
process.env.MANAGER_CODE_MCP_FIRST = '1'
process.env.MANAGER_RAG_MCP_FIRST = '1'
assert(isEnvFlagOn('MANAGER_GUI_MCP_FIRST'), 'gui mcp first')
assert(isEnvFlagOn('MANAGER_CODE_MCP_FIRST'), 'code mcp first')
assert(isEnvFlagOn('MANAGER_RAG_MCP_FIRST'), 'rag mcp first')

assert(CODE_ASSIST_MCP_TOOLS.some((t) => t.name === 'run_code_task'), 'run_code_task tool')

const byPrefix = parseMcpToolStepRequest({
  prefixedToolName: 'code-assist__run_code_task',
  args: { message: '汇总' },
})
assert(byPrefix?.serverName === 'code-assist' && byPrefix.toolName === 'run_code_task', 'prefix parse')

const byFields = parseMcpToolStepRequest({
  serverName: 'rag',
  toolName: 'retrieve',
  args: { query: 'test' },
})
assert(byFields?.serverName === 'rag' && byFields.toolName === 'retrieve', 'field parse')

console.log('smoke-p2-mcp-first: PASS')
