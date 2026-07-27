/**
 * P4 clarify → replan 结构回归
 */
import {
  buildClarifyMergedQuery,
  detectClarifyFollowUp,
  looksLikeClarifyAssistantReply,
  clarifyReplanMetaPatch
} from '../../../server/graph/core/plan/clarifyReplan'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const clarifyBody =
  '为了确保我给出的是你真正需要的答案，请补充以下信息：\n1. 需要查询哪个区域或年龄段？'
assert(looksLikeClarifyAssistantReply(clarifyBody), 'clarify marker')

const merged = buildClarifyMergedQuery('查老人', '河西区 70 到 79 岁')
assert(merged.includes('查老人') && merged.includes('河西区'), 'merged query')

const followUp = detectClarifyFollowUp(
  [
    { role: 'user', content: '查老人' },
    { role: 'assistant', content: clarifyBody },
    { role: 'user', content: '河西区 70 到 79 岁' }
  ],
  '河西区 70 到 79 岁'
)
assert(followUp && followUp.anchor.includes('查老人'), 'detect follow-up')
const patch = clarifyReplanMetaPatch(followUp!)
assert(patch.clarifyReplan === true && patch.needsClarify === false, 'replan meta clears clarify')

console.log('smoke: clarify-replan ok')
