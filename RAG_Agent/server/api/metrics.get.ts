import { getRagQueryMetricCounters, readRecentRagMetrics } from "../utils/query_metrics";

export default defineEventHandler(async () => {
  return {
    ok: true,
    counters: getRagQueryMetricCounters(),
    recent: readRecentRagMetrics(30),
  };
});
