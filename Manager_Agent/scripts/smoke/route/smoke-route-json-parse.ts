/**
 * 路由 JSON 解析回归：qwen3.5 常输出 intent=single，须归一化而非回退 multi。
 */
import { parseRouteLlmJson, recoverRouteFromMalformedLlm } from '../../../server/graph/core/shared/llmJson'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const singleIntentSample = `{
  "intent": "single",
  "confidence": 0.92,
  "rationale": "用户明确要求查询特定人员在数据库中的骨密度仪记录并生成报告",
  "query": "在数据库中查询曹雨欣的骨密度仪测量记录，并分析数据生成报告",
  "entities": { "names": ["曹雨欣"], "records": ["骨密度仪测量记录"], "locations": [], "dates": [] },
  "allowedAgents": ["db", "clean", "code", "report"],
  "needsClarify": false,
  "clarifyQuestions": [],
  "taskStackOp": "none",
  "taskStackTitle": ""
}`

const parsed = parseRouteLlmJson(singleIntentSample)
assert(parsed.success, `single intent should normalize: ${JSON.stringify(parsed.error?.issues ?? parsed)}`)
assert(parsed.data?.intent === 'multi', `expected multi, got ${parsed.data?.intent}`)
assert(
  Array.isArray(parsed.data?.allowedAgents) && parsed.data!.allowedAgents!.includes('db'),
  'allowedAgents should preserve db'
)

const thinkWrapped = `分析用户意图…\n${singleIntentSample}`
const parsedThink = parseRouteLlmJson(thinkWrapped)
assert(parsedThink.success, 'thinking block should be stripped before parse')

const truncated = singleIntentSample.slice(0, singleIntentSample.indexOf('"needsClarify"'))
const recovered = recoverRouteFromMalformedLlm(truncated)
assert(recovered?.intent === 'multi', `truncated recover intent=${recovered?.intent}`)

console.log('smoke: route json parse ok')
