/**
 * P2-B6 / C2-5c：MCP run_code_task edit 路径 smoke（离线，无 LLM）
 */
import { parseManagerCodeTask } from '../server/utils/manager_task'
import { CODE_ASSIST_MCP_TOOLS } from '../server/mcp/codeAssistMcpSchema'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const managerTask = parseManagerCodeTask({
  source: 'manager',
  task_kind: 'edit',
  question: '在 server/utils/code_agent_env.ts 增加注释并 typecheck',
  hint_files: ['server/utils/code_agent_env.ts'],
})
assert(managerTask?.task_kind === 'edit', `task_kind edit, got ${managerTask?.task_kind}`)
assert(
  managerTask?.hint_files?.includes('server/utils/code_agent_env.ts'),
  'hint_files from managerTask',
)

const tool = CODE_ASSIST_MCP_TOOLS.find((t) => t.name === 'run_code_task')
assert(tool, 'run_code_task registered')
const desc = String(tool!.description || '')
assert(/edit|inspect|script/i.test(desc), 'tool desc mentions engineering modes')

console.log('smoke-mcp-code-edit: PASS', {
  taskKind: managerTask?.task_kind,
  hints: managerTask?.hint_files?.length ?? 0,
})
