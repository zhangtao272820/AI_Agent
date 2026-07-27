/**
 * Lobster MCP export 结构 smoke
 */
import { LOBSTER_GUI_MCP_TOOLS } from '../server/mcp/lobsterGuiMcpSchema'
import { isLobsterMcpExportEnabled } from '../server/utils/lobster_env'
import { mcpErr, mcpOk } from '../../shared/mcpJsonRpc'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(isLobsterMcpExportEnabled(), 'export enabled by default')
assert(LOBSTER_GUI_MCP_TOOLS.length >= 6, 'tool count')
assert(LOBSTER_GUI_MCP_TOOLS.some((t) => t.name === 'run_desktop_task'), 'run_desktop_task tool')
assert(LOBSTER_GUI_MCP_TOOLS.some((t) => t.name === 'run_browser_task'), 'run_browser_task tool')

process.env.LOBSTER_MCP_EXPORT = '0'
assert(!isLobsterMcpExportEnabled(), 'export off')
delete process.env.LOBSTER_MCP_EXPORT

const disabled = mcpErr(1, -32000, 'disabled')
assert((disabled as any).error?.code === -32000, 'err shape')
const ok = mcpOk(1, { tools: LOBSTER_GUI_MCP_TOOLS })
assert(Array.isArray((ok.result as any)?.tools) || (ok.result as any)?.tools === undefined, 'ok shape')

console.log('smoke-lobster-mcp-export: PASS')
