/**
 * P1 MCP Host + 各 Agent export 结构 smoke（无网络）
 */
import { LOBSTER_GUI_MCP_TOOLS } from '../../../../Lobster_Agent/server/mcp/lobsterGuiMcpSchema'
import { CODE_ASSIST_MCP_TOOLS, isCodeMcpServerEnabled } from '../../../../code_assistent_Agent/server/mcp/codeAssistMcpSchema'
import { RAG_MCP_TOOLS, isRagMcpServerEnabled } from '../../../../RAG_Agent/server/mcp/ragMcpSchema'
import { isLobsterMcpExportEnabled } from '../../../../Lobster_Agent/server/utils/lobster_env'
import { buildAgentRegistry } from '../../../server/graph/core/agent/agentRegistry'
import {
  mcpOk,
  mcpTextResult,
  prefixToolName,
  splitPrefixedToolName,
  parseMcpToolStepRequest,
} from '#agent-shared/mcpJsonRpc'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function wsToHttp(ws: string) {
  return ws.replace(/^ws/i, 'http').replace(/\/_ws\/?$/, '').replace(/\/+$/, '')
}

function resolveManagerMcpServersForSmoke(env: NodeJS.ProcessEnv) {
  const out: Array<{ name: string; url: string }> = []
  const guiWs = String(env.LOBSTER_AGENT_WS_URL ?? '').trim()
  if (guiWs && String(env.LOBSTER_MCP_EXPORT ?? '1') !== '0') {
    out.push({ name: 'lobster-gui', url: `${wsToHttp(guiWs)}/api/mcp` })
  }
  const codeWs = String(env.CODE_AGENT_WS_URL ?? '').trim()
  if (codeWs && String(env.CODE_MCP_SERVER ?? '0') === '1') {
    out.push({ name: 'code-assist', url: `${wsToHttp(codeWs)}/api/mcp` })
  }
  const ragHttp = String(env.RAG_AGENT_HTTP_URL ?? '').trim()
  if (ragHttp && String(env.RAG_MCP_SERVER ?? '0') === '1') {
    out.push({ name: 'rag', url: `${ragHttp.replace(/\/+$/, '')}/api/mcp` })
  }
  return out
}

assert(LOBSTER_GUI_MCP_TOOLS.some((t) => t.name === 'run_browser_task'), 'lobster tools')
assert(CODE_ASSIST_MCP_TOOLS.some((t) => t.name === 'run_code_task'), 'code run_code_task')
assert(RAG_MCP_TOOLS.some((t) => t.name === 'retrieve'), 'rag tools')

process.env.LOBSTER_MCP_EXPORT = '1'
process.env.CODE_MCP_SERVER = '1'
process.env.RAG_MCP_SERVER = '1'
process.env.LOBSTER_AGENT_WS_URL = 'ws://localhost:13108/_ws'
process.env.CODE_AGENT_WS_URL = 'ws://localhost:13103/_ws'
process.env.RAG_AGENT_HTTP_URL = 'http://localhost:13102'

assert(isLobsterMcpExportEnabled(), 'lobster export')
assert(isCodeMcpServerEnabled(), 'code mcp')
assert(isRagMcpServerEnabled(), 'rag mcp')

const servers = resolveManagerMcpServersForSmoke(process.env)
assert(servers.some((s) => s.name === 'lobster-gui'), 'lobster-gui server')
assert(servers.some((s) => s.name === 'code-assist'), 'code-assist server')
assert(servers.some((s) => s.name === 'rag'), 'rag server')

const prefixed = prefixToolName('lobster-gui', 'run_browser_task')
const split = splitPrefixedToolName(prefixed)
assert(split?.serverName === 'lobster-gui' && split.toolName === 'run_browser_task', 'tool prefix')

const reg = buildAgentRegistry(process.env)
assert(reg.entries.some((e) => e.id === 'gui' && e.mcpUrl?.includes('/api/mcp')), 'registry mcpUrl gui')

const healthShape = mcpOk(1, mcpTextResult({ ok: true }))
assert((healthShape.result as any)?.content?.[0]?.type === 'text', 'mcp text result')

const parsedMcp = parseMcpToolStepRequest({ prefixedToolName: prefixed, args: { task: 'x' } })
assert(parsedMcp?.serverName === 'lobster-gui' && parsedMcp.toolName === 'run_browser_task', 'mcp step parse')

console.log('smoke-manager-mcp-host: PASS')
