/**
 * 解析入站请求应走的执行路径（compute / inspect / edit / script / full）。
 */

import {
  extractManagerUpstreamContext,
  looksLikeManagerComputeTask,
  sanitizeIncomingQuestion,
} from './incoming_question'
import {
  parseManagerCodeTask,
  type CodeTaskKind,
  type ManagerCodeTaskPayload,
  type StructuredUpstreamFact,
} from './manager_task'
import { getCodeAgentEnv } from './code_agent_env'
import { isCodeTaskUnderstandEnabled } from './codeTaskUnderstandSchema'
import { envelopeToV1ManagerTask, parseManagerTaskEnvelope } from '#agent-shared/managerTaskEnvelope'

export type CodeExecutionPlan = {
  taskKind: CodeTaskKind | 'full'
  question: string
  upstreamContext?: string
  upstreamFacts?: StructuredUpstreamFact[]
  hintFiles?: string[]
  hintSymbols?: string[]
  mustOutputs?: string[]
  completionCriteria?: string[]
  writeAllowed: boolean
  fromManager: boolean
}

function resolveManagerTaskInput(input: {
  managerTask?: string | Record<string, unknown> | null
  manager_task_json?: string | Record<string, unknown> | null
  manager_task_envelope_v2?: string | Record<string, unknown> | null
}): ManagerCodeTaskPayload | null {
  const envelope = parseManagerTaskEnvelope(input.manager_task_envelope_v2)
  if (envelope?.payload.kind === 'code') {
    return envelope.payload.data as ManagerCodeTaskPayload
  }
  const v1 =
    parseManagerCodeTask(input.managerTask ?? null) ??
    parseManagerCodeTask(input.manager_task_json ?? null)
  if (v1) return v1
  if (envelope) {
    const legacy = envelopeToV1ManagerTask(envelope)
    return legacy ? (parseManagerCodeTask(legacy) ?? (legacy as ManagerCodeTaskPayload)) : null
  }
  return null
}

function inferTaskKind(message: string, manager: ManagerCodeTaskPayload | null): CodeTaskKind | 'full' {
  if (manager?.task_kind) return manager.task_kind
  if (isCodeTaskUnderstandEnabled()) return 'full'
  if (looksLikeManagerComputeTask(message)) return 'compute'
  return 'full'
}

export function resolveCodeExecutionPlan(input: {
  message: string
  mode?: string
  managerTask?: string | Record<string, unknown> | null
  manager_task_json?: string | Record<string, unknown> | null
  manager_task_envelope_v2?: string | Record<string, unknown> | null
  hint_files?: string[]
  hint_symbols?: string[]
  agent_mode?: 'ask' | 'edit' | 'agent'
}): CodeExecutionPlan {
  const raw = String(input.message ?? '').trim()
  const manager = resolveManagerTaskInput(input)
  const fromManager = Boolean(manager) || looksLikeManagerComputeTask(raw)

  const env = getCodeAgentEnv()
  const upstreamFromMessage = extractManagerUpstreamContext(raw)
  const upstreamContext = (
    manager?.upstream_context ||
    upstreamFromMessage ||
    ''
  )
    .trim()
    .slice(0, env.computeMaxContextChars)

  const question = sanitizeIncomingQuestion(
    manager?.refined_question || raw,
  ).slice(0, env.computeMaxQuestionChars)

  const taskKind = inferTaskKind(raw, manager)
  const clientKind =
    input.agent_mode === 'edit'
      ? 'edit'
      : input.agent_mode === 'ask'
        ? 'inspect'
        : undefined
  const resolvedKind = manager?.task_kind ?? clientKind ?? taskKind

  const hintFiles = [
    ...(manager?.hint_files ?? []),
    ...(input.hint_files ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i)
  const hintSymbols = [
    ...(manager?.hint_symbols ?? []),
    ...(input.hint_symbols ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i)

  return {
    taskKind: resolvedKind,
    question: question || raw.slice(0, env.computeMaxQuestionChars),
    upstreamContext: upstreamContext || undefined,
    upstreamFacts: manager?.facts?.length ? manager.facts : undefined,
    hintFiles: hintFiles.length ? hintFiles : undefined,
    hintSymbols: hintSymbols.length ? hintSymbols : undefined,
    mustOutputs: manager?.must_outputs,
    completionCriteria: manager?.completion_criteria,
    writeAllowed:
      manager?.write_allowed ??
      (resolvedKind === 'edit' || resolvedKind === 'script'),
    fromManager,
  }
}
