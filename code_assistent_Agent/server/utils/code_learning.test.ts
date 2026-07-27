import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeQuestionKey,
  recordFeedback,
  recordQueryOutcome,
  recallSimilarExperience,
  buildExperienceContextBlock,
  getLearningSummary,
  clearLearningData,
  clearRoutePreferences,
} from './code_learning'

const signals = join(process.cwd(), '.data', 'code-learning-signals.jsonl')
const experience = join(process.cwd(), '.data', 'code-query-experience.jsonl')

describe('code_learning', () => {
  beforeEach(() => {
    mkdirSync(join(process.cwd(), '.data'), { recursive: true })
    for (const f of [signals, experience]) {
      if (existsSync(f)) unlinkSync(f)
    }
  })

  afterEach(() => {
    clearLearningData()
    clearRoutePreferences()
  })

  it('normalizes question keys', () => {
    expect(normalizeQuestionKey('  汇总人均补贴？ ')).toBe('汇总人均补贴')
  })

  it('records feedback and builds summary', () => {
    recordFeedback({ question: 'vector search 在哪', score: 1, task_kind: 'inspect' })
    recordFeedback({ question: '错误答案', score: -1, task_kind: 'full', comment: '不准' })
    const s = getLearningSummary()
    expect(s.positive).toBe(1)
    expect(s.negative).toBe(1)
  })

  it('recalls similar experience after successful query', () => {
    recordQueryOutcome({
      question: '足底压力统计逻辑在哪',
      task_kind: 'inspect',
      ok: true,
      hint_files: ['utils/sql_direct.ts'],
    })
    const hits = recallSimilarExperience('足底压力统计', 'inspect')
    expect(hits.length).toBeGreaterThan(0)
    const block = buildExperienceContextBlock('足底压力统计', 'inspect')
    expect(block).toContain('sql_direct')
  })
})
