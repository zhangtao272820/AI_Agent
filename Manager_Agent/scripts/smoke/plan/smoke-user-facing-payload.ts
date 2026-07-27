/**
 * D1 UserFacingPayload：mock plan + handoff，不绑单一问句、不拉 LLM。
 */
import {
  buildUserFacingPayload,
  composeFinalBundleFromGraphResult,
  formatUserFacingMainText,
  stripDeveloperJargon
} from '../../../server/graph/core/output'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cleaned = stripDeveloperJargon('db: agent_result (ok)\n男性 5 人')
assert(!/agent_result/i.test(cleaned), 'strips agent_result')
assert(!/\(ok\)/i.test(cleaned), 'strips (ok)')
assert(cleaned.includes('男性'), 'keeps Chinese conclusion')

const payload = buildUserFacingPayload({
  synth: '',
  intent: 'multi',
  results: {
    db: 'agent_result (ok)\n{"rows":12}',
    rag: '制度条文很长很长很长'
  },
  evidence: [
    {
      kind: 'db',
      handoff: { summary: '库表统计：男性 5 人、女性 3 人', evidenceRefs: ['table:t'], confidence: 0.9 }
    },
    {
      kind: 'rag',
      handoff: { summary: '制度要求按性别汇总申报', evidenceRefs: ['doc:1'], confidence: 0.8 }
    }
  ],
  meta: { lastStepRecords: [{ id: 's1', agent: 'db', status: 'ok' }] }
})

assert(payload.summary.includes('男性') || payload.summary.includes('制度'), 'uses handoff summaries')
assert(!/agent_result/i.test(payload.summary), 'summary has no agent_result')
assert(!/\(ok\)/i.test(payload.summary), 'summary has no (ok)')
assert(!/^db:/m.test(payload.summary), 'summary has no bare db:')
assert(payload.outcome === 'completed', 'default outcome completed')
assert(payload.outcomeLabel === '已完成', 'Chinese outcome label')

const main = formatUserFacingMainText(payload)
assert(!main.includes('## 执行摘要'), 'main text excludes exec summary')

const bundle = composeFinalBundleFromGraphResult({
  final: '',
  intent: 'multi',
  results: {
    db: 'agent_result (ok)\nraw dump should not dominate',
    clean: 'clean intermediate'
  },
  evidence: [
    { kind: 'db', handoff: { summary: '查询完成：共 8 人', evidenceRefs: [], confidence: 0.88 } }
  ],
  meta: {
    lastStepRecords: [{ id: 'a', agent: 'db', status: 'ok', summary: '查询完成：共 8 人' }]
  },
  plan: [
    { id: 'a', agent: 'db', query: '查人数' },
    { id: 'b', agent: 'rag', query: '查制度' }
  ]
})

assert(!/agent_result/i.test(bundle.userFacing.summary), 'compose bundle userFacing clean')
assert(
  bundle.userFacing.summary.includes('8') || bundle.userFacing.summary.includes('查询'),
  'compose prefers handoff over dump'
)
assert(bundle.text.includes('执行摘要') || bundle.userFacing.summary.length > 0, 'audit text or summary present')

const withSynth = composeFinalBundleFromGraphResult({
  final: '本轮结论：养老统计已汇总。',
  intent: 'multi',
  results: { db: 'agent_result (ok)' },
  plan: [
    { id: 'a', agent: 'db', query: 'x' },
    { id: 'b', agent: 'report', query: 'y' }
  ],
  meta: {}
})
assert(withSynth.userFacing.summary.includes('养老统计'), 'synth preferred when present')
assert(!/agent_result/i.test(withSynth.userFacing.summary), 'synth path still strips jargon if leaked')

/** D2：metrics / chart / table / actions 槽位 */
const withSlots = buildUserFacingPayload({
  synth: '结论：性别分布已汇总。',
  intent: 'multi',
  results: {
    visualize: [
      '<!--ECHARTS_OPTION-->',
      JSON.stringify({
        title: { text: '性别分布' },
        xAxis: { data: ['男性', '女性'] },
        series: [{ type: 'bar', data: [5, 3] }]
      }),
      '<!--/ECHARTS_OPTION-->',
      '<!--TABLE_DATA-->',
      '| 性别 | 人数 |',
      '| --- | --- |',
      '| 男性 | 5 |',
      '| 女性 | 3 |',
      '<!--/TABLE_DATA-->'
    ].join('\n'),
    clean: JSON.stringify({
      answer: '已整理事实',
      sources: [{ agent: 'db' }],
      facts: [
        { key: 'male', label: '男性', value: 5, source: 'db', confidence: 0.9 },
        { key: 'female', label: '女性', value: 3, source: 'db', confidence: 0.9 }
      ],
      quality: { conflicts: [], missing_fields: [], deduped_count: 0 },
      data: { mode: 'single_source', raw_source_count: 1 }
    })
  },
  meta: {
    needsHumanConfirm: true,
    humanConfirmAgent: 'admin',
    humanConfirmMessage: '拟发送邮件通知',
    humanConfirmId: 'confirm_test_1',
    adminPendingOps: ['send_email']
  }
})
assert(withSlots.chart?.title === '性别分布', 'chart title from visualize')
assert(withSlots.chart?.option && typeof withSlots.chart.option === 'object', 'chart option present')
assert(withSlots.table?.headers?.includes('性别'), 'table headers chinese')
assert((withSlots.metrics?.length || 0) >= 1, 'metrics from clean facts')
assert(withSlots.metrics!.some((m) => m.label === '男性'), 'metric label chinese')
assert(withSlots.actions?.length === 1, 'actions from needsHumanConfirm')
assert(withSlots.actions![0]!.status === 'awaiting_confirm', 'action awaiting confirm')
assert(withSlots.outcome === 'needs_human', 'needs_human outcome')

console.log('smoke-user-facing-payload: ok')
