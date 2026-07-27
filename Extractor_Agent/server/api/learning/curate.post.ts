import { runLearningCurator } from '../../utils/learning_curator'
import { getExtractorAgentEnv } from '../../utils/extractor_agent_env'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as {
    autoPromote?: boolean
    minHits?: number
  } | null
  const report = await runLearningCurator({
    autoPromote: body?.autoPromote !== false,
    minHits: Number.isFinite(body?.minHits) ? Number(body!.minHits) : undefined,
  })
  return { ok: true, report, minHits: getExtractorAgentEnv().promptPromoteMinHits }
})
