import { aggregateCrawlMetrics, getCrawlMetricCounters, readRecentCrawlMetrics } from '../utils/crawl_metrics'
import { getExtractorAgentEnv } from '../utils/extractor_agent_env'

export default defineEventHandler(async () => {
  const limit = getExtractorAgentEnv().metricsRecentLimit
  const recent = readRecentCrawlMetrics(limit)
  return {
    ok: true,
    counters: getCrawlMetricCounters(),
    recent,
    aggregate: aggregateCrawlMetrics(recent),
  }
})
