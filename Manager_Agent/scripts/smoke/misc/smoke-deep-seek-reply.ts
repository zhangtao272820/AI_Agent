import { formatFactsAsDeepSeekReply } from '#agent-shared/deepSeekReplyFormat'

const footLike = formatFactsAsDeepSeekReply({
  facts: [
    { key: '整体-压力平均值', value: 13.35 },
    { key: '整体-压力最大值', value: 45.3 },
    { key: '左-足弓指', value: 0.41 },
    { key: '左-脚宽', value: 8.78 },
    { key: '创建人', value: 1 },
    { key: '修改人', value: 1 }
  ],
  sourceHint: '取数'
})

if (/足弓指标|压力分布|足部尺寸|数据库查询/.test(footLike)) {
  throw new Error('reply must not use domain-specific section titles')
}
if (footLike.includes('创建人') || footLike.includes('修改人')) {
  throw new Error('metadata must be filtered from reply')
}
if (!footLike.includes('### 整体') || !footLike.includes('### 左')) {
  throw new Error('should group by structural prefix')
}
if (footLike.includes('0.41') && footLike.includes('41%')) {
  throw new Error('must not relabel decimals as percent')
}

const financeLike = formatFactsAsDeepSeekReply({
  facts: [
    { key: 'monthly_finance.income', value: 6000 },
    { key: 'monthly_finance.expense', value: 5000 },
    { key: 'ratios.savings_rate', value: '16.67%' }
  ],
  answer: '本月收支已汇总，结余与储蓄率见下列指标。',
  sourceHint: 'Code'
})

if (!financeLike.includes('### monthly_finance') || !financeLike.includes('### ratios')) {
  throw new Error('dotted keys should group by prefix')
}
if (!financeLike.includes('本月收支已汇总')) {
  throw new Error('readable answer should be used as opening')
}

const large = formatFactsAsDeepSeekReply({
  facts: Array.from({ length: 24 }, (_, i) => ({ key: `指标-${i + 1}`, value: i + 1 })),
  sourceHint: '取数'
})
if (!large.includes('24') || !large.includes('未全部展开') || !large.includes('另有')) {
  throw new Error('large fact sets should be capped with notice')
}

console.log('smoke: generic deepSeek reply format ok')
