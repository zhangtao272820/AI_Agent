import { getQueryMetricCounters } from "../../utils/query_metrics";
import { getDbAgentBlueprintEnv } from "../../utils/db_agent_env";

export default defineEventHandler(() => {
  const counters = getQueryMetricCounters();
  const env = getDbAgentBlueprintEnv();
  const directOk = counters["sql_direct:ok"] ?? 0;
  const directFail = Object.entries(counters)
    .filter(([k]) => k.startsWith("sql_direct:") && k.includes("fail"))
    .reduce((s, [, v]) => s + v, 0);
  const agentOk = counters["sql_agent:ok"] ?? 0;
  const agentFail = Object.entries(counters)
    .filter(([k]) => k.startsWith("sql_agent:") && k.includes("fail"))
    .reduce((s, [, v]) => s + v, 0);
  const directTotal = directOk + directFail;
  const agentTotal = agentOk + agentFail;

  const templateDirect = counters["sql_direct:ok:sql_template_direct"] ?? 0;
  const experienceDirect = counters["sql_direct:ok:experience_sql_direct"] ?? 0;
  const planDirect = counters["sql_direct:ok:sql_plan_direct"] ?? 0;
  const queryIr =
    (counters["sql_direct:ok:query_ir"] ?? 0) + (counters["sql_direct:ok:query_ir_repair"] ?? 0);
  const agentFallback = counters["sql_agent:ok:agent_fallback"] ?? 0;

  return {
    counters,
    summary: {
      domain: env.domain,
      profile: env.profile,
      sql_direct_rate: directTotal > 0 ? directOk / directTotal : null,
      sql_agent_fallback_rate: directTotal + agentTotal > 0 ? agentTotal / (directTotal + agentTotal) : null,
      sql_template_direct_hits: templateDirect,
      experience_sql_direct_hits: experienceDirect,
      sql_plan_direct_hits: planDirect,
      query_ir_hits: queryIr,
      agent_fallback_hits: agentFallback,
      schema_cache_ttl_sec: env.schemaCacheTtlSec,
      enable_sql_template_direct: env.enableSqlTemplateDirect,
      enable_experience_sql_direct: env.enableExperienceSqlDirect,
      enable_metrics_direct: env.enableMetricsDirect,
    },
  };
});
