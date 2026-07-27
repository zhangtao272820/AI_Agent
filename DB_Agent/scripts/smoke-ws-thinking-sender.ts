import { createWsThinkingSender } from '../server/utils/wsThinkingSender'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const sent: string[] = []
const sender = createWsThinkingSender({
  send: (raw) => {
    const parsed = JSON.parse(raw) as { event?: string; data?: string }
    if (parsed.event === 'thinking') sent.push(String(parsed.data || ''))
  },
})

sender('步骤一')
sender('步骤二')

await new Promise<void>((r) => setTimeout(r, 30))

assert(sent.length === 2, `expected 2 thinking frames, got ${sent.length}: ${sent.join(' | ')}`)
assert(sent[0] === '步骤一' && sent[1] === '步骤二', 'thinking order mismatch')

console.log('smoke: ws thinking sender ok')
