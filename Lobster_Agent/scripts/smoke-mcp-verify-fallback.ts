/**
 * MCP verify + Docker 引擎链 smoke（无网络）
 */
import assert from 'node:assert/strict'
import { verifyLobsterRunResult, isLobsterRetryableFailure } from '../../shared/lobsterRunVerifyLite'
import { reorderChainForHeadlessMcpSidecar } from '../server/services/lobsterTaskSpec'
import { validateMcpBrowserAction, McpToolLoopTracker } from '../server/services/mcpComplexRecovery'

const task = '打开 https://www.baidu.com/ 搜索 Python 教程'

const verify = verifyLobsterRunResult({
  task,
  status: 'done',
  result: {
    answer: 'MCP 模式已达最大步数，请缩小任务范围或改用 classic 模式。',
    finalUrl: 'https://www.baidu.com/',
    failureType: 'incomplete_max_steps',
  },
})
assert.equal(verify.ok, false)
assert.equal(verify.reason, 'incomplete_max_steps')
assert.equal(
  isLobsterRetryableFailure({ status: 'done', result: {}, verify: { reason: verify.reason } }),
  true,
)

process.env.LOBSTER_MCP_HEADLESS_SIDECAR = '1'
const chain = reorderChainForHeadlessMcpSidecar(['mcp', 'stagehand', 'classic'], task, 'https://www.baidu.com/')
assert.equal(chain[0], 'classic', 'baidu docker chain classic first')

assert.ok(validateMcpBrowserAction('browser_type', { text: 'hello' }), 'missing ref')
assert.equal(validateMcpBrowserAction('browser_type', { ref: 'e1', text: 'hello' }), null)

const loop = new McpToolLoopTracker()
loop.observeToolCall('browser_type', { ref: 'e1', text: 'a' }, 'https://www.baidu.com/')
loop.observeToolCall('browser_type', { ref: 'e1', text: 'a' }, 'https://www.baidu.com/')
loop.observeToolCall('browser_type', { ref: 'e1', text: 'a' }, 'https://www.baidu.com/')
const hit = loop.observeToolCall('browser_type', { ref: 'e1', text: 'a' }, 'https://www.baidu.com/')
assert.equal(hit.looped, true, 'tool loop detected')

console.log('[smoke-mcp-verify-fallback] OK')
