/**
 * 总管 → Lobster poll 路径 smoke（无网络 · OpenClaw 类 confirm 桥接）
 */
import { verifyLobsterRunResult } from '#agent-shared/lobsterRunVerifyLite'
import { resolveLobsterHttpBase } from '../../../server/utils/mcp/lobsterGuiPoll'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(typeof resolveLobsterHttpBase === 'function', 'resolveLobsterHttpBase export')

const base = resolveLobsterHttpBase({
  LOBSTER_AGENT_WS_URL: 'ws://localhost:13108/_ws',
} as NodeJS.ProcessEnv)
assert(base === 'http://localhost:13108', 'ws→http base')

const pending = {
  id: 'c1',
  title: '高风险浏览器操作',
  message: '是否继续？',
  ts: Date.now(),
}
assert(pending.id && pending.title, 'pending confirm contract')

const pollDone = verifyLobsterRunResult({
  task: '去百度搜索 LangGraph 并打开第一条',
  status: 'done',
  result: {
    answer: '已打开第一条结果',
    finalUrl: 'https://www.baidu.com/s?wd=LangGraph',
  },
})
assert(pollDone.ok, 'poll verify ok path')

const denied = verifyLobsterRunResult({
  task: '打开记事本输入 Hello',
  status: 'error',
  result: { answer: '已中止：高风险操作未获确认。', failureType: 'need_human' },
  error: 'user_denied_in_run_confirm',
})
assert(!denied.ok, 'in-run deny verify fail')

console.log('smoke-manager-lobster-poll: PASS')
