/**
 * Mgr-Markers / synth shape smoke：结构 + meta，不依赖 HEAVY_TASK 词表。
 */
import {
  resolveSynthShapeSignals,
  wantsMultiCompareExecution,
  wantsNarrativeReportSynth,
} from '#agent-shared/synthShapePolicy'
import { mockIntentClassifyForTest } from '../../../server/graph/llm/intentClassifyLlm'
import { shouldUseIntentRagFastPath, alignIntentClassifyWithRecall } from '../../../server/graph/core/rag/intentRagRecallCore'
import type { IntentRecallHit } from '../../../server/graph/core/rag/intentRagRecallCore'
import { shouldDeferReportToSynth } from '#agent-shared/reportSynthDefer'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const metaMulti = {
  intentClassify: mockIntentClassifyForTest({
    primaryIntent: 'multi',
    isMulti: true,
    explicitWantsReport: true,
    explicitWantsVisualize: true,
    planShortcut: 'none',
  }),
  wantsReportHint: true,
  wantsVisualizeHint: true,
  taskShape: 'multi_source_parallel',
}

const shape = resolveSynthShapeSignals({
  meta: metaMulti,
  planSteps: [
    { agent: 'rag' },
    { agent: 'db' },
    { agent: 'report' },
    { agent: 'visualize' },
  ],
  questionLength: 40,
})
assert(shape.multiSourceSynth, 'multi source from plan+meta')
assert(shape.narrativeReport, 'narrative from explicitWantsReport')
assert(wantsMultiCompareExecution({ meta: metaMulti, planSteps: [{ agent: 'report' }, { agent: 'visualize' }, { agent: 'rag' }] }), 'multi compare')

const narrativeOnly = wantsNarrativeReportSynth({
  meta: { wantsReportHint: true },
  planSteps: [{ agent: 'report' }],
})
assert(narrativeOnly, 'report step → narrative')

const keywordOnly = resolveSynthShapeSignals({ questionLength: 20 })
assert(!keywordOnly.multiSourceSynth, 'keywords alone must not trigger heavy synth')

const playbookHit: IntentRecallHit = {
  id: 'pb',
  score: 0.92,
  source: 'playbook',
  matchedText: 'x',
  primaryIntent: 'rag',
  isMulti: false,
  suggestedAgents: ['rag'],
  isDbAnchored: false,
  needsAdmin: false,
  needsWeb: false,
  explicitWantsReport: false,
  explicitWantsVisualize: false,
  planShortcut: 'rag_only',
  explanation: 'test',
}
assert(!shouldUseIntentRagFastPath(playbookHit, '对比两份方案'), 'playbook must not fast-path classify')

const llm = mockIntentClassifyForTest({
  primaryIntent: 'db',
  planShortcut: 'db_only',
  isMulti: false,
})
const aligned = alignIntentClassifyWithRecall(
  llm,
  {
    items: [],
    text: '',
    count: 1,
    vectorRecall: false,
    scenarioKey: '',
    topHit: playbookHit,
  },
  '统计人数',
)
assert(aligned.primaryIntent === 'db', 'playbook align must not override LLM intent')

const deferMulti = shouldDeferReportToSynth(
  { db: 'x', rag: 'y' },
  { planSteps: [{ agent: 'report' }] },
)
assert(deferMulti, 'multi-source pipeline defers report')

const deferKeyword = shouldDeferReportToSynth(
  { db: 'only' },
  {},
)
assert(!deferKeyword, 'keywords alone must not defer report')

console.log('smoke-synth-shape-policy: OK')
