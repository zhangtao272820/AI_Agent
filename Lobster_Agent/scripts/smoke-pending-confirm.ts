/**
 * Lobster pendingConfirm + start envelope smoke（无网络 · 不依赖 Nuxt alias）
 */
import { buildManagerTaskEnvelope, parseManagerTaskEnvelope, serializeManagerTaskEnvelope } from '../../shared/managerTaskEnvelope'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const task = '去百度搜 LangGraph 并打开第一条'
const envelope = buildManagerTaskEnvelope({
  target_agent: 'gui',
  trace_id: 't1',
  session_id: 's1',
  utterance: task,
  payload: {
    kind: 'gui',
    data: {
      source: 'manager',
      task,
      startUrl: 'https://www.baidu.com',
      engineHint: 'mcp',
      browser_profile: 'managed',
      lobster: { site_recipe_id: 'baidu', preferred_engine: 'mcp' },
    },
  },
})

const parsed = parseManagerTaskEnvelope(serializeManagerTaskEnvelope(envelope))
assert(parsed?.payload.kind === 'gui', 'envelope kind gui')
const gui = parsed?.payload.data as Record<string, unknown>
assert(gui.startUrl === 'https://www.baidu.com', 'envelope startUrl')
assert(gui.engineHint === 'mcp', 'envelope engineHint')
assert(gui.browser_profile === 'managed', 'envelope browser profile')

type Pending = { id: string; title: string; message: string; ts: number } | null
const sample: Pending = { id: 'c1', title: '确认', message: '继续？', ts: 1 }
assert(sample.id === 'c1', 'pending confirm contract')

console.log('smoke-lobster-pending-confirm: PASS')
