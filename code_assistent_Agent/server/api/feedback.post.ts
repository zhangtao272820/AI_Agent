import { recordFeedback } from '../utils/code_learning'
import { evolveFromNegativeFeedback } from '../utils/code_prompt_evolution'
import { getCodeAgentEnv } from '../utils/code_agent_env'
import type { CodeTaskKind } from '../utils/code_learning'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    question?: string
    score?: number
    comment?: string
    task_kind?: CodeTaskKind
    hint_files?: string[]
  }>(event)

  const question = String(body?.question ?? '').trim()
  const score = Number(body?.score)
  if (!question) {
    throw createError({ statusCode: 400, statusMessage: 'question 不能为空' })
  }
  if (!Number.isFinite(score) || (score !== 1 && score !== -1)) {
    throw createError({ statusCode: 400, statusMessage: 'score 须为 1 或 -1' })
  }

  recordFeedback({
    question: question.slice(0, 500),
    score,
    comment: String(body?.comment ?? '').trim().slice(0, 300) || undefined,
    task_kind: body?.task_kind,
    hint_files: Array.isArray(body?.hint_files)
      ? body.hint_files.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
      : undefined,
  })

  if (score === -1 && getCodeAgentEnv().enablePromptEvolution) {
    evolveFromNegativeFeedback(question, String(body?.comment ?? ''))
  }

  return { ok: true }
})
