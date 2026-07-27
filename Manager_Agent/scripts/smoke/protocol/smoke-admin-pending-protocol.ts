/**
 * Admin pending_decide 协议 smoke（离线纯函数）
 */
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

async function main() {
  const execUrl = pathToFileURL(
    join(__dirname, '../../../server/graph/core/stepIsolation/exec.ts')
  ).href
  const agentResultUrl = pathToFileURL(
    join(__dirname, '../../../server/utils/agents/agentResult.ts')
  ).href

  const {
    adminResponseSignalsPendingConfirm,
    extractAdminPendingActions,
    extractAdminPendingOps
  } = await import(execUrl)
  const { wrapAdminResult } = await import(agentResultUrl)

  const pendingText = '【待确认】将添加会议提醒 add_event[1]'
  const agentResult = {
    ok: false,
    agent: 'admin',
    answer: pendingText,
    structured: {
      needs_human_confirm: true,
      pending_actions: [{ id: 42, tool: 'add_event', title: '明天下午3点会议提醒', time: '2026-07-14 15:00' }]
    }
  }

  assert(adminResponseSignalsPendingConfirm(pendingText, agentResult), 'pending via structured')
  assert(!adminResponseSignalsPendingConfirm('天津今日晴', { ok: true, agent: 'admin', structured: {} }), 'non-pending text without signal')

  const rows = extractAdminPendingActions(agentResult)
  assert(rows.length === 1 && rows[0]!.id === 42, 'extract pending_actions id')
  assert(rows[0]!.title?.includes('会议'), 'extract pending_actions title')

  const wrapped = wrapAdminResult(pendingText, 'trace-1')
  assert(wrapped.ok === false, 'wrapAdminResult marks pending as not ok')
  assert(wrapped.structured?.needs_human_confirm === true, 'wrapAdminResult needs_human_confirm')

  const clarifyFail = wrapAdminResult('抱歉，添加提醒时遇到了一点小问题。请问会议的具体内容是什么？', 't2')
  assert(clarifyFail.ok === false, 'clarify after write fail must be ok=false')

  const clarifyFail2 = wrapAdminResult('请指定需要设置提醒的会议名称或时间。', 't3')
  assert(clarifyFail2.ok === false, '请指定 clarify must be ok=false')

  const ops = extractAdminPendingOps(pendingText)
  assert(ops.includes('add_event[1]'), 'fallback op scan')

  // 成功文案含裸 add_event 不得判为待确认（否则完成后续跑死循环）
  const successText =
    '已添加日程并设置提醒：帮我创建明天上午10点的会议日程，标题为「项目周会」 add_event (2026年7月24日 10:00)'
  assert(!extractAdminPendingOps(successText).length, 'bare add_event must not be pending op')
  assert(
    !adminResponseSignalsPendingConfirm(successText, { ok: true, agent: 'admin', structured: {} }),
    'success text must not signal pending'
  )

  console.log('smoke-admin-pending-protocol: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
