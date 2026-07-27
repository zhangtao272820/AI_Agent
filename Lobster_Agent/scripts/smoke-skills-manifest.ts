/**
 * Lobster skills manifest smoke（无网络）
 */
import { LOBSTER_GUI_MCP_TOOLS } from '../server/mcp/lobsterGuiMcpSchema'
import {
  listLobsterMcpToolNames,
  listLobsterSkillIds,
  loadLobsterSkillsManifest,
} from '../server/utils/lobsterSkillLoader'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const manifest = loadLobsterSkillsManifest()
assert(manifest?.name === 'lobster-gui', 'manifest name')
assert(Array.isArray(manifest?.skills) && manifest!.skills!.length >= 3, 'skills list')
assert(manifest?.skills?.includes('browser-automation'), 'browser-automation skill')
assert(manifest?.skills?.includes('desktop-automation'), 'desktop-automation skill')
assert(manifest?.skills?.includes('android-automation'), 'android-automation skill')

const skillIds = listLobsterSkillIds()
assert(skillIds.includes('browser-automation'), 'listLobsterSkillIds')

const mcpNames = listLobsterMcpToolNames()
assert(mcpNames.includes('run_browser_task'), 'manifest mcp run_browser_task')
assert(mcpNames.includes('resolve_run_confirm'), 'manifest mcp resolve_run_confirm')

const schemaNames = LOBSTER_GUI_MCP_TOOLS.map((t) => t.name)
for (const name of mcpNames) {
  assert(schemaNames.includes(name), `schema has ${name}`)
}

console.log('smoke-lobster-skills-manifest: PASS')
