import { resolveLeanRagQuery, stripPlanConstraintsFromQuery } from '../../../server/graph/core/probe/retrieverPlan'

const onlyConstraint = '\n\n约束：保留对象约束：个人财务'
const strippedOnly = stripPlanConstraintsFromQuery(onlyConstraint)
if (!strippedOnly) {
  throw new Error('strip should not return empty for constraint-only routedQuery')
}
const resolved = resolveLeanRagQuery(onlyConstraint, '查询个人月度收支与结余')
if (resolved !== '查询个人月度收支与结余') {
  throw new Error(`expected lastUser fallback, got: ${resolved}`)
}

const withBase = '检索个人财务数据\n\n约束：保留对象约束：本人'
if (stripPlanConstraintsFromQuery(withBase) !== '检索个人财务数据') {
  throw new Error('strip should keep head before constraint block')
}

const template = [
  '【检索任务】请仅依据文档作答',
  '【核心问句】个人月度收入支出结余',
  '【输出要求】要点列表'
].join('\n')
if (resolveLeanRagQuery(template, '') !== '个人月度收入支出结余') {
  throw new Error('should extract manager core question')
}

console.log('smoke: rag query resolve ok')
