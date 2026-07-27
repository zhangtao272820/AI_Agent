import { describe, expect, it } from 'vitest'
import { detectCodeClarification, mergeClarificationChip } from './code_clarification'
import { buildCodePlan } from './code_plan'

describe('code_clarification', () => {
  it('skips manager compute tasks', () => {
    const out = detectCodeClarification({
      question: '汇总',
      taskKind: 'compute',
      fromManager: true,
    })
    expect(out.needsClarify).toBe(false)
  })

  it('skips manager edit tasks (orchestrated by Manager)', () => {
    const out = detectCodeClarification({
      question: '在 RAG_Agent 增加 BM25 开关并运行 typecheck',
      taskKind: 'edit',
      fromManager: true,
      writeAllowed: true,
    })
    expect(out.needsClarify).toBe(false)
  })

  it('recognizes monorepo agent directory as scope', () => {
    const out = detectCodeClarification({
      question: '在 RAG_Agent 增加 BM25 开关并运行 typecheck',
      taskKind: 'edit',
      writeAllowed: true,
    })
    expect(out.needsClarify).toBe(false)
  })

  it('asks for file on vague edit', () => {
    const out = detectCodeClarification({
      question: '改一下',
      taskKind: 'edit',
      writeAllowed: true,
    })
    expect(out.needsClarify).toBe(true)
    expect(out.chips.length).toBeGreaterThan(0)
  })

  it('merges chip into question', () => {
    expect(mergeClarificationChip('分析登录', 'server/services/agent.ts')).toContain('agent.ts')
  })
})

describe('code_plan', () => {
  it('builds manager compute plan without clarify', () => {
    const plan = buildCodePlan({
      message: '汇总',
      managerTask: {
        task_kind: 'compute',
        upstream_context: 'db: 1',
        refined_question: '汇总',
      },
    })
    expect(plan.task_kind).toBe('compute')
    expect(plan.needsClarify).toBe(false)
  })

  it('builds manager edit plan without clarify', () => {
    const plan = buildCodePlan({
      message: '在 RAG_Agent 增加 BM25 开关并运行 typecheck',
      managerTask: {
        source: 'manager',
        task_kind: 'edit',
        refined_question: '在 RAG_Agent 增加 BM25 开关并运行 typecheck',
        write_allowed: true,
      },
    })
    expect(plan.task_kind).toBe('edit')
    expect(plan.needsClarify).toBe(false)
  })
})
