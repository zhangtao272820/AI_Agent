/**
 * P2-C1：MCP 传输模式 smoke（无网络）
 */
import assert from 'node:assert/strict'
import {
  lobsterMcpTransportMode,
  resolveLobsterMcpServers,
  shouldUseLocalHeadedMcp,
} from '../server/utils/lobster_env'

const prevUrl = process.env.LOBSTER_MCP_URL
const prevHeadless = process.env.LOBSTER_HEADLESS
const prevLocal = process.env.LOBSTER_MCP_USE_LOCAL_HEADED

try {
  delete process.env.LOBSTER_MCP_USE_LOCAL_HEADED
  process.env.LOBSTER_MCP_URL = 'http://playwright_mcp:8931/mcp'
  assert.equal(lobsterMcpTransportMode(), 'sidecar-http')

  delete process.env.LOBSTER_MCP_URL
  process.env.LOBSTER_HEADLESS = 'true'
  assert.equal(lobsterMcpTransportMode(), 'stdio-headless')
  const headlessCfg = resolveLobsterMcpServers()
  assert.ok(headlessCfg?.playwright && 'args' in headlessCfg.playwright)
  assert.ok((headlessCfg.playwright as { args?: string[] }).args?.includes('--headless'))

  process.env.LOBSTER_MCP_USE_LOCAL_HEADED = '1'
  process.env.LOBSTER_HEADLESS = 'false'
  process.env.DISPLAY = ':99'
  assert.equal(shouldUseLocalHeadedMcp(), true)
  assert.equal(lobsterMcpTransportMode(), 'stdio-headed')
  const headedCfg = resolveLobsterMcpServers()
  const headedArgs = (headedCfg?.playwright as { args?: string[] })?.args || []
  assert.equal(headedArgs.includes('--headless'), false, 'local headed skips --headless')
} finally {
  if (prevUrl === undefined) delete process.env.LOBSTER_MCP_URL
  else process.env.LOBSTER_MCP_URL = prevUrl
  if (prevHeadless === undefined) delete process.env.LOBSTER_HEADLESS
  else process.env.LOBSTER_HEADLESS = prevHeadless
  if (prevLocal === undefined) delete process.env.LOBSTER_MCP_USE_LOCAL_HEADED
  else process.env.LOBSTER_MCP_USE_LOCAL_HEADED = prevLocal
}

console.log('[smoke-mcp-transport] OK')
