/**
 * P3 · architect + monorepo subpath smoke（离线）
 */
import { isCodeArchitectModeEnabled, formatEditPlanBlock } from '../server/utils/codeArchitectShared'
import { getEditTaskPlaybookBlock } from '../server/utils/code_playbook_prompts'
import { CODE_ASSIST_MCP_TOOLS } from '../server/mcp/codeAssistMcpSchema'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

process.env.CODE_ARCHITECT_MODE = '1'
assert(isCodeArchitectModeEnabled(), 'architect env')

const playbook = getEditTaskPlaybookBlock()
assert(playbook.includes('apply_search_replace') || playbook.includes('validate'), 'edit loop skill loaded')

assert(CODE_ASSIST_MCP_TOOLS.some((t) => t.name === 'get_repo_map'), 'MCP get_repo_map')
assert(CODE_ASSIST_MCP_TOOLS.some((t) => t.name === 'validate_project'), 'MCP validate_project')

const plan = formatEditPlanBlock({
  summary: 'test',
  steps: ['a'],
  target_files: ['x.ts'],
})
assert(plan.includes('x.ts'), 'plan format')

process.env.CODE_REPO_SUBPATH = 'code_assistent_Agent'
const { getRoot } = await import('../server/utils/files')
const root = getRoot()
assert(root.replace(/\\/g, '/').endsWith('code_assistent_Agent'), 'subpath root')

console.log('smoke-code-p3-quick: PASS')
