/**
 * 污染 skill 清理 + 能力漂移门禁 smoke
 */
import fs from 'node:fs'
import path from 'node:path'
import { skillPathAlignsWithUser } from '../../../server/graph/core/memory/userIntentSupremacy'
import { intentPlaybookById } from '../../../server/graph/core/memory/intentPlaybook'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const skillsRoot = path.join(process.cwd(), 'skills')
const removed = [
  'manager_1_从知识库中提取用户个人月度财务数据包括月收入月支出月结余2_从公开权威网站检索',
  'manager_在知识库中检索个人月度财务情况提炼要点并生成对比图表并帮我创建明天上午_10_点的会议日程',
  'manager_基于知识库中提供的个人月度财务数据月收入6000元月支出5000元月净结余940元重新',
  'manager_根据_code_提供的唯一可信数据源月收入6000元支出5000元结余1000元重新生',
  'manager_1_明确确认用户月支出5000元是否包含公积金510元与五险560元若未明确需从知识库中提',
  'manager_从知识库养老机构服务规范中提取失能半失能认知障碍三类老人的护理员配比要求确保数据单位为',
  'manager_在数据库中查询张明宇的骨密度仪检测记录汇总后生成报告',
  'manager_在数据库中查询陈子墨的中医就诊记录并汇总后生成报告',
  'manager_在数据库中查询林婉清足底压力测试记录汇总后生成报告结论与注意事项',
  'manager_在数据库中查询李雨桐的人力驾驶舱的项目记录',
]
for (const id of removed) {
  assert(!fs.existsSync(path.join(skillsRoot, id)), `polluted skill removed: ${id}`)
}

const curated = [
  'intent_rag_finance_lookup',
  'intent_rag_finance_chart',
  'intent_rag_finance_multi',
  'intent_rag_doc_norm_lookup',
  'intent_rag_admin_combo'
]
for (const id of curated) {
  assert(fs.existsSync(path.join(skillsRoot, id, 'skill.md')), `curated skill present: ${id}`)
}

const financeQ = '在知识库中查询我的月度财务状况'
assert(
  !skillPathAlignsWithUser(financeQ, ['rag', 'clean', 'code', 'report']),
  'polluted finance path rejected'
)
assert(skillPathAlignsWithUser(financeQ, ['rag']), 'rag-only path ok')

const chartQ = '从知识库取财务数据画对比图'
assert(
  skillPathAlignsWithUser(chartQ, ['rag', 'code', 'visualize']),
  'explicit chart path ok'
)

const ragFinance = intentPlaybookById('rag_finance_kb')
assert(ragFinance?.suggestedAgents?.join() === 'rag', 'playbook rag_finance_kb')
const ragNorm = intentPlaybookById('rag_compliance_norm_lookup')
assert(ragNorm?.planShortcut === 'rag_only', 'playbook elderly care norm')

console.log('smoke: skill cleanup ok')
