/**
 * 轻量 CodePlan：task_kind / 澄清 / hint（HTTP plan 与 WS 前置门禁共用）。
 */
import { resolveCodeExecutionPlan } from './code_execution'
import { detectCodeClarification } from './code_clarification'
import { parseManagerCodeTask } from './manager_task'
import type { CodeTaskKind } from './code_learning'

export type CodePlan = {
  ok: boolean
  query: string
  task_kind: CodeTaskKind | 'full'
  needsClarify: boolean
  clarifyQuestions: string[]
  clarifyChips: string[]
  missingSlots: string[]
  hint_files?: string[]
  write_allowed: boolean
  from_manager: boolean
}

export function buildCodePlan(input: {
  message?: string
  query?: string
  managerTask?: unknown
  manager_task_json?: unknown
}): CodePlan {
  const raw = String(input.query ?? input.message ?? '').trim()
  const plan = resolveCodeExecutionPlan({
    message: raw,
    managerTask: input.managerTask as any,
    manager_task_json: input.manager_task_json as any,
  })
  const manager = parseManagerCodeTask(input.managerTask as any) ?? parseManagerCodeTask(input.manager_task_json as any)
  const clarify = detectCodeClarification({
    question: plan.question,
    taskKind: plan.taskKind,
    hintFiles: plan.hintFiles,
    upstreamContext: plan.upstreamContext,
    fromManager: plan.fromManager,
    writeAllowed: plan.writeAllowed,
  })

  return {
    ok: true,
    query: plan.question,
    task_kind: plan.taskKind,
    needsClarify: clarify.needsClarify,
    clarifyQuestions: clarify.questions,
    clarifyChips: clarify.chips,
    missingSlots: clarify.missingSlots,
    hint_files: plan.hintFiles ?? manager?.hint_files,
    write_allowed: plan.writeAllowed,
    from_manager: plan.fromManager,
  }
}
