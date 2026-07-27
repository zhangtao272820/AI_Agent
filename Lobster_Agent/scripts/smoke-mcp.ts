/**
 * Playwright MCP 探针：验证 LOBSTER_MCP_* 配置能否列出工具。
 * 用法：LOBSTER_EXECUTION_MODE=mcp npx tsx scripts/smoke-mcp.ts
 */
import { probeLobsterMcpReady } from '../server/services/lobsterMcpAgent'
import { resolveLobsterExecutionMode, resolveLobsterMcpServers } from '../server/utils/lobster_env'

const mode = resolveLobsterExecutionMode()
const servers = resolveLobsterMcpServers()

console.log('[smoke-mcp] executionMode=', mode)
console.log('[smoke-mcp] servers=', servers ? Object.keys(servers) : [])

const probe = await probeLobsterMcpReady()
console.log('[smoke-mcp] probe=', probe)

if (!probe.ok) {
  console.error('[smoke-mcp] FAIL:', probe.error || 'mcp not ready')
  process.exit(1)
}

console.log('[smoke-mcp] OK toolCount=', probe.toolCount)
