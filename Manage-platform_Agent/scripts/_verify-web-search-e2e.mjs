/**
 * Container smoke: SearXNG + DashScope plan with enable_thinking=false.
 * Expects both legs to finish quickly (no indefinite hang).
 */
const t0 = Date.now()
const searx = await fetch(
  `http://searxng:8080/search?q=${encodeURIComponent('北京天气')}&format=json`,
  { signal: AbortSignal.timeout(25_000) }
)
if (!searx.ok) throw new Error(`searxng status ${searx.status}`)
const sj = await searx.json()
const hits = Array.isArray(sj.results) ? sj.results.length : 0
console.log(JSON.stringify({ step: 'searxng', hits, ms: Date.now() - t0 }))

const base = String(process.env.OPENAI_BASE_URL || '').replace(/\/$/, '')
const key = String(process.env.OPENAI_API_KEY || '')
const model = String(process.env.OPENAI_MODEL || 'qwen3.5-flash-2026-02-23')
if (!base || !key) throw new Error('missing OPENAI_BASE_URL / OPENAI_API_KEY')

const t1 = Date.now()
const res = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model,
    messages: [
      {
        role: 'system',
        content:
          '你是联网检索规划器。只输出 JSON。schema: {"subQueries":string[],"expectedEvidence":string[],"stopCondition":string,"confidence":number}'
      },
      { role: 'user', content: '用户问题：今天北京天气怎么样' }
    ],
    max_tokens: 256,
    temperature: 0,
    enable_thinking: false
  }),
  signal: AbortSignal.timeout(60_000)
})
const body = await res.json()
const msg = body?.choices?.[0]?.message || {}
const content = String(msg.content || '')
const reasoning = msg.reasoning_content
console.log(
  JSON.stringify({
    step: 'plan_llm',
    status: res.status,
    ms: Date.now() - t1,
    has_reasoning: Boolean(reasoning && String(reasoning).length),
    content_slice: content.slice(0, 160).replace(/\n/g, ' ')
  })
)
if (!hits) throw new Error('searxng returned 0 hits')
if (!res.ok) throw new Error(`llm status ${res.status}`)
console.log(JSON.stringify({ ok: true, total_ms: Date.now() - t0 }))
