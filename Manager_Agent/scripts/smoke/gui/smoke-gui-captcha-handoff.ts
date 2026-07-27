/**
 * GUI 验证码 HITL 协议 smoke（P1-A · 协议 §4.4.6）
 * - verify 识别 task_blocked / captcha
 * - 人工确认后重试应走 classic（非无头 MCP）
 */
import assert from 'node:assert/strict'
import {
  detectLobsterSemanticBlock,
  verifyLobsterRunResult,
} from '#agent-shared/lobsterRunVerifyLite'
import {
  buildGuiHumanConfirmMessage,
  isGuiHumanHandoffFailure,
} from '../../../server/utils/gui/guiHumanConfirm'
import {
  resolveGuiHandoffTimeoutMs,
  resolveGuiTimeoutMs,
} from '../../../server/graph/core/executors/guiExecutor'

// captcha URL 应被 verify 判为 task_blocked
const captchaVerify = verifyLobsterRunResult({
  task: '打开百度搜索 Python',
  status: 'done',
  result: {
    answer: '页面触发验证码',
    finalUrl: 'https://wappass.baidu.com/static/captcha/tuxing_v2.html',
  },
})
assert.equal(captchaVerify.ok, false)
assert.equal(captchaVerify.reason, 'task_blocked')
assert.equal(captchaVerify.failureType, 'captcha')

// MCP snapshot 文本也应识别
const block = detectLobsterSemanticBlock({
  text: 'Page URL: https://wappass.baidu.com/static/captcha/tuxing_v2.html\n人机验证',
})
assert(block?.failureType === 'captcha', 'snapshot captcha block')

// HITL 类型
assert(isGuiHumanHandoffFailure('captcha'))
assert(isGuiHumanHandoffFailure('need_login'))
assert(!isGuiHumanHandoffFailure('browser_infra_unavailable'))

// 确认文案应说明 classic 重试
const copy = buildGuiHumanConfirmMessage({
  failureType: 'captcha',
  task: '百度搜索 LangGraph',
  finalUrl: 'https://wappass.baidu.com/static/captcha/tuxing_v2.html',
})
assert(copy.title.includes('验证码'))
assert(copy.message.includes('classic'), 'confirm message mentions classic retry')
assert(copy.message.includes('不能'), 'confirm message clarifies manager cannot click captcha')

const baseTimeout = resolveGuiTimeoutMs(90_000, '打开百度搜索')
assert(baseTimeout >= 360_000, 'default gui timeout >= 360s')
const handoffTimeout = resolveGuiHandoffTimeoutMs(baseTimeout, '打开百度搜索')
assert(handoffTimeout >= 480_000, 'handoff timeout >= 480s')

console.log('smoke: gui captcha handoff protocol ok')
