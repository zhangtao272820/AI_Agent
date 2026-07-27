import { recordFeedbackSignal } from '../utils/crawl_learning'
import { getRunMeta } from '../utils/crawl_metrics'
import { appendPromptPatch } from '../utils/prompt_evolution'
import { getExtractorAgentEnv } from '../utils/extractor_agent_env'
import { resolveFeedbackStage } from '../utils/feedbackStageLlm'
import { ChatOpenAI } from '@langchain/openai'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    task?: string
    score?: number
    comment?: string
    target_site?: string
    channel?: string
    source?: string
  }>(event)

  const task = String(body?.task ?? '').trim()
  const score = Number(body?.score)
  if (!task) {
    throw createError({ statusCode: 400, statusMessage: 'task 不能为空' })
  }
  if (!Number.isFinite(score) || (score !== 1 && score !== -1)) {
    throw createError({ statusCode: 400, statusMessage: 'score 须为 1 或 -1' })
  }

  const last = getRunMeta()
  const channel = String(body?.channel ?? last?.primary_channel ?? '').trim()
  recordFeedbackSignal({
    task: task.slice(0, 500),
    score,
    comment: String(body?.comment ?? '').trim().slice(0, 300) || undefined,
    target_site: String(body?.target_site ?? last?.target_site ?? '').trim() || undefined,
    channel: channel === 'http' || channel === 'browser' || channel === 'mcp' || channel === 'skill' ? channel : undefined,
    source: String(body?.source ?? '').trim() || undefined,
  })

  if (score === -1 && getExtractorAgentEnv().enablePromptEvolution) {
    const comment = String(body?.comment ?? '').trim()
    const text =
      comment ||
      `用户标记不准：${task.slice(0, 60)}${channel ? `（通道 ${channel}）` : ''}`
    const key = String(process.env.OPENAI_API_KEY ?? '').trim()
    const model = key
      ? new ChatOpenAI({
          apiKey: key,
          modelName: String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
          configuration: { baseURL: process.env.OPENAI_BASE_URL },
          temperature: 0,
        })
      : null
    const stage = await resolveFeedbackStage(model, text)
    appendPromptPatch({ stage, text, source: 'feedback' })
  }

  return { ok: true }
})
