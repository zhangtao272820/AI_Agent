import { getCodeQueryMetricCounters, readRecentCodeMetrics } from '../utils/code_metrics'
import { readRecentCodeNluMetrics } from '../utils/code_nlu_metrics'

export default defineEventHandler(async () => {
  return {
    ok: true,
    counters: getCodeQueryMetricCounters(),
    recent: readRecentCodeMetrics(),
    nlu_recent: readRecentCodeNluMetrics(),
  }
})
