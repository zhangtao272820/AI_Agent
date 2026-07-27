/**
 * Critic 审计上下文 smoke：证据须注入 prompt，且与评估器一致时不应触发改道重试。
 */
import {
  criticRetryContradictsRunEvidence,
  formatEvidenceForCriticAudit,
  formatEvaluatorForCriticAudit
} from '../../../server/graph/core/output/criticEvidence'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const results = {
  rag: '[事实1] 月收入：6000 月支出：5000 公积金：510 五险：560 [来源] 个人月收入.txt'
}
const evidence = [{ kind: 'rag', hits: 1, citations: [{ source: '个人月收入.txt' }] }]
const evaluation = {
  score: 1,
  hasDataEvidence: true,
  hasImplicitDataEvidence: true,
  recommendation: 'accept'
}

const auditBlock = formatEvidenceForCriticAudit({ evidence, results })
assert(auditBlock.includes('个人月收入.txt'), 'critic audit includes citation')
assert(auditBlock.includes('6000'), 'critic audit includes rag output numbers')

const evalBlock = formatEvaluatorForCriticAudit(evaluation)
assert(evalBlock.includes('dataEvidence=yes'), 'critic audit includes evaluator')

const shouldIgnoreRetry = criticRetryContradictsRunEvidence({ evaluation })
assert(shouldIgnoreRetry, 'good evidence + evaluator should override critic retry')

console.log('smoke: critic evidence ok')
