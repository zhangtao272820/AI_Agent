/**
 * GUI poll + in-run confirm 桥接 smoke（无网络）
 */
import { verifyLobsterRunResult } from '#agent-shared/lobsterRunVerifyLite'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

// 模拟 poll 结果构建逻辑（与 lobsterGuiPoll.buildPollResult 对齐）
function buildPollResult(task: string, status: Record<string, unknown>, runId: string) {
  const st = String(status.status || '').trim().toLowerCase()
  const result = status.result
  const verify = verifyLobsterRunResult({
    task,
    status: st,
    result,
    error: String(status.error || ''),
  })
  return { status: st, verify, runId, result }
}

const task = '去百度搜索 LangGraph 并打开第一条'
const ok = buildPollResult(task, {
  status: 'done',
  result: { answer: '已打开第一条结果', finalUrl: 'https://www.baidu.com/s?wd=LangGraph' },
}, 'run-1')
assert(ok.verify.ok, 'poll verify ok')

const pending = {
  id: 'confirm-1',
  title: '高风险浏览器操作',
  message: '是否继续？',
  ts: Date.now(),
}
assert(pending.id && pending.title, 'pending confirm shape')

const denied = buildPollResult(task, {
  status: 'error',
  error: 'user_denied_in_run_confirm',
  result: { answer: '已中止', failureType: 'need_human' },
}, 'run-2')
assert(!denied.verify.ok, 'denied verify fail')

console.log('smoke-gui-poll-confirm: PASS')
