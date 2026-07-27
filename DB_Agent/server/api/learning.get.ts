import { getExperienceRecallSummary, getLearningSummary } from "../../utils/query_learning";
import { listPromptPatches, getPromptEvolutionSummary, listPromotablePatches } from "../../utils/prompt_evolution";
import { getQueryMetricCounters } from "../../utils/query_metrics";
import { getRoutePreferencesSummary } from "../../utils/query_route_policy";
import { getSqlTemplateSummary } from "../../utils/query_sql_templates";
import { getUserPreferencesSummary } from "../../utils/user_preferences";
import { ensureRateLimit } from "../../utils/rate";
import { DB_AGENT_DEFAULTS } from "../../utils/db_agent_env";

export default defineEventHandler((event) => {
  ensureRateLimit(event, { max: 60, refillPerSec: 30 });
  const minHits = DB_AGENT_DEFAULTS.promptPromoteMinHits;
  return {
    learning: getLearningSummary(),
    metrics: getQueryMetricCounters(),
    routePolicy: getRoutePreferencesSummary(),
    promptPatches: listPromptPatches().slice(-12),
    promotablePatches: listPromotablePatches(minHits),
    evolution: getPromptEvolutionSummary(),
    sqlTemplates: getSqlTemplateSummary(),
    userPreferences: getUserPreferencesSummary(),
    experienceVectors: getExperienceRecallSummary(),
  };
});
