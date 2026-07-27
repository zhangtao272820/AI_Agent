/**
 * C1-3 / C2-4b：script exports + sandbox/run_command 统一 smoke
 */
import { listPackageScripts, formatPackageScriptsBlock, resolvePackageManager } from '../server/utils/packageScripts'
import { CODE_ASSIST_MCP_TOOLS } from '../server/mcp/codeAssistMcpSchema'
import { validateAllowlistedCommand } from '../server/utils/runCommand'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const entries = await listPackageScripts()
assert(Array.isArray(entries), 'listPackageScripts returns array')
assert(entries.some((e) => e.name === 'typecheck' || e.name === 'test'), 'has common scripts')

const block = formatPackageScriptsBlock(entries.slice(0, 3))
assert(block.includes('`'), 'formatted block')

const pm = resolvePackageManager()
assert(pm === 'pnpm' || pm === 'npm', 'package manager resolved')

assert(CODE_ASSIST_MCP_TOOLS.some((t) => t.name === 'list_scripts'), 'MCP list_scripts')

assert(validateAllowlistedCommand(['pnpm', 'run', 'typecheck']).ok, 'pnpm run allowed')
assert(validateAllowlistedCommand(['npm', 'run', 'test']).ok, 'npm run allowed')

console.log('smoke-code-script-exports: PASS', { scripts: entries.length, pm })
