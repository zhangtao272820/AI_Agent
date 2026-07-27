import { getLearningSummary } from '../utils/crawl_learning'
import { aggregateCrawlMetrics, getCrawlMetricCounters, readRecentCrawlMetrics } from '../utils/crawl_metrics'
import { getExtractorAgentEnv } from '../utils/extractor_agent_env'
import { getRoutePreferencesSummary } from '../utils/crawl_route_policy'
import { getExtractTemplateSummary } from '../utils/crawl_extract_templates'
import { listStoredSessionHosts } from '../utils/crawl_session_store'
import { getExperienceSummary } from '../utils/crawl_experience'
import { getPromptEvolutionSummary } from '../utils/prompt_evolution'
import { getUserPreferencesSummary } from '../utils/user_preferences'
import { getExperienceVectorSummary } from '../utils/experience_vectors'

export default defineEventHandler(async () => {
  const limit = Math.min(30, getExtractorAgentEnv().metricsRecentLimit)
  const recent = readRecentCrawlMetrics(limit)
  return {
    ok: true,
    learning: getLearningSummary(),
    routePolicy: getRoutePreferencesSummary(),
    extractTemplates: getExtractTemplateSummary(),
    experience: getExperienceSummary(),
    vectorExperience: getExperienceVectorSummary(),
    userPreferences: getUserPreferencesSummary(),
    promptEvolution: getPromptEvolutionSummary(),
    sessions: { hosts: listStoredSessionHosts() },
    metrics: {
      counters: getCrawlMetricCounters(),
      recent,
      aggregate: aggregateCrawlMetrics(recent),
    },
  }
})
