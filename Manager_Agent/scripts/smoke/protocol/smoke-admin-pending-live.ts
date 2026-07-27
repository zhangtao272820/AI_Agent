/**
 * Admin HITL 端到端 smoke：auto_confirm_risky=false 应返回【待确认】而非直接写失败。
 * 用法：npx tsx scripts/smoke/protocol/smoke-admin-pending-live.ts
 */
import WebSocket from 'ws'

const WS_URL = process.env.AI_ADMIN_AGENT_WS_URL || 'ws://127.0.0.1:13105/api/chat/ws'
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 120000)

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

async function main() {
  const ws = new WebSocket(WS_URL)
  const result = await new Promise<{ text: string; agentResult?: Record<string, unknown> }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          message: '帮我添加明天下午3点的会议提醒',
          session_id: `smoke-pending-${Date.now()}`,
          auto_confirm_risky: false,
          trace_id: 'smoke-admin-pending',
          client_context: {
            manager_orchestrated: true,
            manager_task: { source: 'manager', action_text: '帮我添加明天下午3点的会议提醒' }
          }
        })
      )
    })
    ws.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(String(raw)) as { type?: string; response?: string; agentResult?: Record<string, unknown>; error?: string }
        if (data.type === 'final') {
          clearTimeout(timer)
          ws.close()
          resolve({ text: String(data.response || ''), agentResult: data.agentResult })
        }
        if (data.type === 'error') {
          clearTimeout(timer)
          ws.close()
          reject(new Error(String(data.error || 'ws error')))
        }
      } catch (e) {
        void e
      }
    })
    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })

  console.log('response head:', result.text.slice(0, 200))
  assert(/【待确认】/.test(result.text), `expected 【待确认】, got: ${result.text.slice(0, 120)}`)
  assert(!/遇到小问题/.test(result.text), 'should not direct-write fail')
  const structured = (result.agentResult?.structured || {}) as Record<string, unknown>
  const pending = structured.pending_actions
  assert(Array.isArray(pending) && pending.length > 0, `expected pending_actions, got: ${JSON.stringify(result.agentResult)}`)
  assert(result.agentResult?.ok === false, `pending should mark ok=false, got: ${JSON.stringify(result.agentResult?.ok)}`)
  console.log('smoke-admin-pending-live: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
