/**
 * P2-A mcp_tool_node + P1-A gui site recipe smoke（无网络）
 */
import { enrichGuiLobsterMeta } from '#agent-shared/guiSiteRecipesLite'
import { buildManagerTaskEnvelope, serializeManagerTaskEnvelope } from '#agent-shared/managerTaskEnvelope'
import { resolveMcpDirectCallFromMeta } from '../../../server/utils/mcp/resolveMcpDirectCall'
import { verifyLobsterRunResult } from '#agent-shared/lobsterRunVerifyLite'
import {
  buildGuiHumanConfirmMessage,
  extractGuiObservationFromRaw,
  guiFailureTypeLabel,
  isGuiHumanHandoffFailure,
  normalizeGuiScreenshotDataUrl,
  resolveGuiFailureType,
} from '../../../server/utils/gui/guiHumanConfirm'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const guiTask = '去百度搜索 LangGraph 并打开第一条'
const lobster = enrichGuiLobsterMeta(guiTask, 'https://www.baidu.com')
assert(lobster?.site_recipe_id === 'baidu', 'baidu recipe')
assert(lobster?.preferred_engine === 'mcp', 'baidu engine')

const envelope = buildManagerTaskEnvelope({
  target_agent: 'gui',
  trace_id: 'mcp-node-1',
  session_id: 's1',
  utterance: guiTask,
  payload: {
    kind: 'gui',
    data: {
      source: 'manager',
      task: guiTask,
      startUrl: 'https://www.baidu.com',
      lobster,
    },
  },
  mcp: {
    server: 'lobster-gui',
    tool: 'run_browser_task',
    arguments: { task: guiTask, start_url: 'https://www.baidu.com' },
  },
})

const meta = {
  mcpDirectCall: {
    serverName: 'lobster-gui',
    toolName: 'run_browser_task',
    args: { task: guiTask },
  },
  managerTaskEnvelope: serializeManagerTaskEnvelope(envelope),
}

const fromDirect = resolveMcpDirectCallFromMeta(meta)
assert(fromDirect?.serverName === 'lobster-gui', 'direct call')
assert(fromDirect?.toolName === 'run_browser_task', 'direct tool')

const fromEnvelopeOnly = resolveMcpDirectCallFromMeta({
  managerTaskEnvelope: serializeManagerTaskEnvelope(envelope),
})
assert(fromEnvelopeOnly?.serverName === 'lobster-gui', 'envelope mcp')

const verifyOk = verifyLobsterRunResult({
  task: guiTask,
  status: 'done',
  result: { answer: '已打开第一条结果', finalUrl: 'https://www.baidu.com/s?wd=LangGraph' },
})
assert(verifyOk.ok, 'verify ok')

const verifyFail = verifyLobsterRunResult({ task: guiTask, status: 'done', result: {} })
assert(!verifyFail.ok && verifyFail.reason === 'empty_result', 'verify empty')

const verifyInfra = verifyLobsterRunResult({
  task: guiTask,
  status: 'done',
  result: {
    answer: '浏览器启动失败：Chromium distribution chrome is not found',
    data: [{ text: 'Run npx playwright install chrome' }],
  },
})
assert(!verifyInfra.ok && verifyInfra.reason === 'browser_infra_unavailable', 'verify infra fail')

const verifyCaptcha = verifyLobsterRunResult({
  task: guiTask,
  status: 'done',
  result: {
    answer: '搜索过程中触发了百度验证码，无法自动通过。请人工完成验证后重试。',
    finalUrl: 'https://wappass.baidu.com/static/captcha/tuxing_v2.html',
  },
})
assert(!verifyCaptcha.ok && verifyCaptcha.reason === 'task_blocked' && verifyCaptcha.failureType === 'captcha', 'verify captcha fail')

const verifyMaxSteps = verifyLobsterRunResult({
  task: guiTask,
  status: 'done',
  result: {
    answer: 'MCP 模式已达最大步数，请缩小任务范围或改用 classic 模式。',
    finalUrl: 'https://www.baidu.com/',
    failureType: 'incomplete_max_steps',
  },
})
assert(!verifyMaxSteps.ok && verifyMaxSteps.reason === 'incomplete_max_steps', 'verify max steps fail')

const verifySearchStuck = verifyLobsterRunResult({
  task: guiTask,
  status: 'done',
  result: {
    answer: '已完成百度搜索',
    finalUrl: 'https://www.baidu.com/',
  },
})
assert(!verifySearchStuck.ok && verifySearchStuck.reason === 'search_no_results', 'verify search stuck on homepage')

assert(isGuiHumanHandoffFailure('captcha'), 'gui handoff captcha')
assert(!isGuiHumanHandoffFailure('empty_result'), 'gui handoff skip empty')
const ft = resolveGuiFailureType({
  verify: { reason: 'task_blocked', failureType: 'captcha' },
  agentResult: { ok: false, agent: 'gui', error_code: 'captcha' },
})
assert(ft === 'captcha', 'resolve failure type')
const copy = buildGuiHumanConfirmMessage({
  failureType: 'captcha',
  task: guiTask,
  finalUrl: 'https://wappass.baidu.com/static/captcha/tuxing_v2.html',
})
assert(copy.title.includes('验证码'), 'human confirm title')

const obs = extractGuiObservationFromRaw({
  run_id: 'lobster-run-1',
  page_url: 'https://wappass.baidu.com/static/captcha/tuxing_v2.html',
  screenshot_data_url: 'data:image/png;base64,abc',
})
assert(obs.lobsterRunId === 'lobster-run-1', 'obs run id')
assert(obs.pageUrl?.includes('wappass'), 'obs page url')
assert(normalizeGuiScreenshotDataUrl('data:image/png;base64,abc') === 'data:image/png;base64,abc', 'screenshot normalize')
assert(guiFailureTypeLabel('captcha') === '验证码', 'failure label')

console.log('smoke-p2-mcp-tool-node: PASS')
