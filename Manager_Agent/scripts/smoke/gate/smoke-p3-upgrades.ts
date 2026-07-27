/**
 * P3 升级回归：output 并行调度、collab preview、chart_plan 预填、多语言 label、PNG 导出元数据。
 */
import { buildCleanPreviewSummary } from '#agent-shared/cleanPayload'
import { buildChartPngExportMeta } from '#agent-shared/chartExportMeta'
import {
  chartPlanLanguageRule,
  detectTaskLanguage,
  reportPlanLanguageRule
} from '#agent-shared/taskLanguage'
import {
  buildCollabPreviewPayload
} from '../../../server/graph/core/plan/collabPreview'
import {
  assignOutputParallelGroups,
  prioritizeOutputParallelBatch,
  scheduleWaitIntervalMs
} from '../../../server/graph/core/plan/planParallel'

function isCodePrefillChartPlanEnabled(): boolean {
  return String(process.env.MANAGER_CODE_PREFILL_CHART_PLAN ?? '1').trim() !== '0'
}

function shouldEnrichCodeByLlm(codeRaw: string): boolean {
  if (String(process.env.MANAGER_CODE_AUTHORITY_LLM ?? '1').trim() === '0') return false
  if (!isCodePrefillChartPlanEnabled()) return false
  const txt = String(codeRaw ?? '').trim()
  if (!txt.startsWith('{')) return false
  try {
    const obj = JSON.parse(txt) as { facts?: unknown[]; data?: Record<string, unknown> }
    const facts = Array.isArray(obj.facts) ? obj.facts : []
    const plan = obj.data?.chart_plan ?? obj.data?.chartPlan
    if (plan && typeof plan === 'object' && Array.isArray((plan as { panels?: unknown[] }).panels)) {
      const panels = (plan as { panels: { series?: unknown[] }[] }).panels
      if (panels.some((p) => Array.isArray(p.series) && p.series.length >= 1)) return false
    }
    return facts.length >= 2
  } catch {
    return false
  }
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

// P3-1: visualize ∥ report 并行组
const plan = assignOutputParallelGroups([
  { id: 's_code', agent: 'code', query: 'c' },
  { id: 's_viz', agent: 'visualize', query: 'v' },
  { id: 's_rep', agent: 'report', query: 'r' }
])
const viz = plan.find((s) => s.agent === 'visualize')!
const rep = plan.find((s) => s.agent === 'report')!
assert(viz.parallelGroup === 'output' && rep.parallelGroup === 'output', 'output parallelGroup assigned')

const ready = [
  { id: 'a', agent: 'db' as const, query: 'd' },
  { id: 'b', agent: 'visualize' as const, query: 'v' },
  { id: 'c', agent: 'report' as const, query: 'r' }
]
const batch = prioritizeOutputParallelBatch(ready, 2)
assert(batch[0]?.agent === 'visualize' && batch[1]?.agent === 'report', 'output batch prioritized')

const waitMs = scheduleWaitIntervalMs(
  [{ id: 's_v', agent: 'visualize', query: 'v', dependsOn: ['s_code'] }],
  [
    { id: 's_code', agent: 'code', query: 'c' },
    { id: 's_v', agent: 'visualize', query: 'v', dependsOn: ['s_code'] }
  ],
  { s_code: { status: 'running' } }
)
assert(waitMs === 60, 'output layer short poll when blocked by code')

// P3-2: clean preview → collab payload
const cleanRaw = JSON.stringify({
  answer: '华东领先',
  facts: [
    { key: 'east', value: 100, label: '华东', source: 'rag' },
    { key: 'west', value: 80, label: '华西', source: 'rag' }
  ],
  data: { cleaned_from: 'rag', mode: 'single_source_deterministic' }
})
const cleanPreviewLoose = buildCleanPreviewSummary(cleanRaw)
assert(cleanPreviewLoose?.factCount === 2 && cleanPreviewLoose.sources?.includes('rag'), 'clean preview infers sources')

const cleanRawFull = JSON.stringify({
  answer: '华东领先',
  facts: [
    { key: 'east', value: 100, label: '华东' },
    { key: 'west', value: 80, label: '华西' }
  ],
  sources: [{ agent: 'db' }],
  quality: { conflicts: [], missing_fields: [], deduped_count: 0 },
  data: { mode: 'multi_source_aligned', raw_source_count: 1 }
})
const cleanPreview = buildCleanPreviewSummary(cleanRawFull)
assert(cleanPreview?.factCount === 2 && cleanPreview.sources?.includes('db'), 'clean preview summary')
const collab = buildCollabPreviewPayload('clean', cleanRawFull, 'pipeline')
assert(collab?.agent === 'clean' && collab.summary.includes('华东'), 'collab preview payload')

const vizText = [
  '<!--ECHARTS_OPTION-->',
  JSON.stringify({ title: { text: '区域对比' }, series: [{ type: 'bar', data: [1, 2] }] }),
  '<!--/ECHARTS_OPTION-->'
].join('\n')
const vizCollab = buildCollabPreviewPayload('visualize', vizText)
assert(vizCollab?.summary === '区域对比', 'visualize collab title')

// P3-3: chart_plan 预填默认开启
const prev = process.env.MANAGER_CODE_PREFILL_CHART_PLAN
delete process.env.MANAGER_CODE_PREFILL_CHART_PLAN
assert(isCodePrefillChartPlanEnabled(), 'prefill enabled by default')
process.env.MANAGER_CODE_PREFILL_CHART_PLAN = '0'
assert(!isCodePrefillChartPlanEnabled(), 'prefill disabled when env=0')
if (prev === undefined) delete process.env.MANAGER_CODE_PREFILL_CHART_PLAN
else process.env.MANAGER_CODE_PREFILL_CHART_PLAN = prev

const codeNoPlan = JSON.stringify({
  answer: 'ok',
  facts: [
    { key: 'a', value: 1, label: 'A' },
    { key: 'b', value: 2, label: 'B' }
  ],
  data: {}
})
process.env.MANAGER_CODE_AUTHORITY_LLM = '1'
process.env.MANAGER_CODE_PREFILL_CHART_PLAN = '1'
assert(shouldEnrichCodeByLlm(codeNoPlan), 'enrich when chartable facts without chart_plan')

// P3-4: 多语言 label 规则
assert(detectTaskLanguage('Compare sales by region in Q4') === 'en', 'detect en task')
assert(detectTaskLanguage('对比华东华西销售') === 'zh', 'detect zh task')
assert(chartPlanLanguageRule('Compare sales').includes('English'), 'chart en rule')
assert(reportPlanLanguageRule('对比销售').includes('中文'), 'report zh rule')

// P3-5: PNG 导出元数据
const opt = { title: { text: '区域销售' }, series: [{ type: 'bar', data: [1, 2] }] }
const meta = buildChartPngExportMeta(opt, { source: 'visualize' })
assert(meta.width === 800 && meta.filename.endsWith('.png'), 'export meta filename')
assert(meta.chartType === 'bar' && meta.title === '区域销售', 'export meta chart fields')
assert(meta.subtitle.includes('source:visualize'), 'export meta subtitle')

console.log('smoke: p3 upgrades ok')
