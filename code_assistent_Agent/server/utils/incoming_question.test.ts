import { describe, expect, it } from 'vitest'
import {
  extractManagerUpstreamContext,
  looksLikeManagerComputeTask,
  sanitizeIncomingQuestion,
} from './incoming_question'
import { parseManagerCodeTask } from './manager_task'
import { resolveCodeExecutionPlan } from './code_execution'

describe('incoming_question', () => {
  it('detects manager compute wrapper', () => {
    const raw =
      '汇总各机构补贴\n\n已知上下文：rag:\n制度A…\n\n请基于以上上下文做计算/整理/推导。只输出最终结果，避免重复说明。'
    expect(looksLikeManagerComputeTask(raw)).toBe(true)
    expect(extractManagerUpstreamContext(raw)).toContain('制度A')
    expect(sanitizeIncomingQuestion(raw)).toBe('汇总各机构补贴')
  })

  it('strips planner blocks', () => {
    const raw = '修复登录 bug\n\n[上游 rag]\n旧上下文…'
    expect(sanitizeIncomingQuestion(raw)).toBe('修复登录 bug')
  })
})

describe('manager_task', () => {
  it('parses managerTask json', () => {
    const out = parseManagerCodeTask({
      task_kind: 'compute',
      refined_question: '算均值',
      upstream_context: 'db: 100, 200',
    })
    expect(out?.task_kind).toBe('compute')
    expect(out?.refined_question).toBe('算均值')
  })
})

describe('code_execution', () => {
  it('routes manager-style message to compute', () => {
    const plan = resolveCodeExecutionPlan({
      message:
        '人均补贴\n\n已知上下文：db:\n100\n\n请基于以上上下文做计算/整理/推导。只输出最终结果。',
      mode: 'auto',
    })
    expect(plan.taskKind).toBe('compute')
    expect(plan.fromManager).toBe(true)
    expect(plan.upstreamContext).toContain('100')
  })

  it('keeps standalone edit on full path', () => {
    const plan = resolveCodeExecutionPlan({
      message: '请修改 server/utils/db.ts 修复空指针',
      mode: 'auto',
    })
    expect(plan.taskKind).toBe('edit')
  })
})
