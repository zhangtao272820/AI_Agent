/**
 * multi 流水线 db 问句：规划器注入表名时不应覆盖用户原话。
 */
import {
  pickRichestDbQuestion,
  resolveMultiDbEffectiveQuery,
  stepHasInjectedTableHint
} from '../../../server/utils/db/managerDbQuestionLlm'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const lastUser = '查询夏语茉的情绪识别仪检测记录'
const plannerStep = '查询 remote_psychology_mood 表中夏语茉的情绪识别仪检测记录'

assert(stepHasInjectedTableHint(plannerStep, lastUser), 'detect planner table injection')
assert(
  pickRichestDbQuestion(plannerStep, lastUser) === lastUser,
  'pickRichestDbQuestion prefers user over injected table'
)
assert(
  resolveMultiDbEffectiveQuery(plannerStep, lastUser, lastUser) === lastUser,
  'resolveMultiDbEffectiveQuery matches direct db user question'
)

console.log('smoke-db-multi-question: ok')
