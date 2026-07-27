/**
 * P3 subagent · 多文件拆分 smoke（离线）
 */
import {
  planFileSubagents,
  shouldUseFileSubagents,
  isCodeSubagentEnabled,
  resolveSubagentMinFiles,
} from '../server/utils/codeSubagent'
import { CODE_ASSIST_MCP_TOOLS } from '../server/mcp/codeAssistMcpSchema'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

process.env.CODE_SUBAGENT_ENABLED = '1'
assert(isCodeSubagentEnabled(), 'subagent env')

const files = ['a.ts', 'b.ts', 'c.ts']
assert(
  shouldUseFileSubagents({
    taskKind: 'edit',
    hintFiles: files,
    enabled: true,
    minFiles: resolveSubagentMinFiles(),
  }),
  'should split',
)

const subs = planFileSubagents({ question: '重构三个文件', hintFiles: files })
assert(subs.length === 3, '3 subtasks')
assert(subs[0]?.hintFiles[0] === 'a.ts', 'first file')

assert(!shouldUseFileSubagents({ taskKind: 'inspect', hintFiles: files, enabled: true }), 'inspect skip')
assert(CODE_ASSIST_MCP_TOOLS.some((t) => t.name === 'export_facts_csv'), 'MCP export_facts_csv')

console.log('smoke-subagent-split: PASS', { subtasks: subs.length })
