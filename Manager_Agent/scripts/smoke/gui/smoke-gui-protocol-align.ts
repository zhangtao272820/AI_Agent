/**
 * 总管 ↔ Lobster 协议对齐 smoke（纯函数，无网络）
 */
import assert from 'node:assert/strict'
import {
  isDesktopGuiTask,
  parseGuiTaskHints,
} from '../../../server/graph/core/agent/guiTaskPayload'
import { LOBSTER_GUI_MCP_TOOLS } from '../../../../Lobster_Agent/server/mcp/lobsterGuiMcpSchema'
import {
  buildManagerTaskEnvelope,
  serializeManagerTaskEnvelope,
} from '#agent-shared/managerTaskEnvelope'

assert(parseGuiTaskHints('引擎:desktop\n打开记事本').engineHint === 'desktop', 'desktop engine hint')
assert(parseGuiTaskHints('profile:user\n打开百度').browserProfile === 'user', 'browser profile hint')
assert(isDesktopGuiTask('打开记事本输入 Hello'), 'desktop task detect')
assert(!isDesktopGuiTask('打开百度', 'https://www.baidu.com'), 'url skips desktop')

const env = buildManagerTaskEnvelope({
  target_agent: 'gui',
  trace_id: 't1',
  session_id: 's1',
  utterance: '打开 runoob 搜索',
  payload: {
    kind: 'gui',
    data: {
      source: 'manager',
      task: '打开 runoob 搜索',
      engineHint: 'mcp',
      browser_profile: 'managed',
    },
  },
})
const ser = serializeManagerTaskEnvelope(env)
assert(ser.includes('browser_profile'), 'envelope has browser_profile')

assert(LOBSTER_GUI_MCP_TOOLS.some((t) => t.name === 'run_desktop_task'), 'run_desktop_task exported')
assert(LOBSTER_GUI_MCP_TOOLS.some((t) => t.name === 'run_browser_task'), 'run_browser_task exported')

console.log('smoke-gui-protocol-align: PASS')
