/**
 * P2-C2：desktop verify smoke（无 Windows-MCP 连接）
 */
import assert from 'node:assert/strict'
import { verifyLobsterRunResult, isLobsterRetryableFailure } from '../../shared/lobsterRunVerifyLite'

const g4Task = '打开记事本，输入 Hello World，保存到桌面。'

const ok = verifyLobsterRunResult({
  task: g4Task,
  status: 'done',
  result: {
    engine: 'desktop',
    answer: '已在记事本输入 Hello World，并保存到桌面 hello.txt。',
  },
})
assert.equal(ok.ok, true, 'G4 success')
assert.equal(ok.reason, 'ok')

const noSave = verifyLobsterRunResult({
  task: g4Task,
  status: 'done',
  result: {
    engine: 'desktop',
    answer: '已在记事本输入 Hello World。',
  },
})
assert.equal(noSave.ok, false, 'G4 missing save')
assert.equal(noSave.reason, 'desktop_save_unverified')

const maxSteps = verifyLobsterRunResult({
  task: g4Task,
  status: 'done',
  result: {
    engine: 'desktop',
    answer: 'Desktop MCP 已达最大步数，请缩小任务范围或检查 Windows-MCP sidecar。',
    failureType: 'incomplete_max_steps',
  },
})
assert.equal(maxSteps.ok, false)
assert.equal(maxSteps.reason, 'incomplete_max_steps')
assert.equal(
  isLobsterRetryableFailure({ status: 'done', result: {}, verify: { reason: maxSteps.reason } }),
  true,
)

console.log('[smoke-desktop-verify] OK')
