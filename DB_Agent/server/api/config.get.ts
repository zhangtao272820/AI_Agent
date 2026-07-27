import { getDbAgentBlueprintEnv } from "../../utils/db_agent_env";
import { loadDomainPatch } from "../../utils/domain_patch";
import { resolveAgentRuntimeConfig } from "../../utils/runtime";

/** 前端 / 运维：当前库连接与域补丁信息（不含密钥） */
export default defineEventHandler((event) => {
  const runtimeConfig = useRuntimeConfig(event) as any;
  let mysqlDatabase = "";
  let mysqlHost = "";
  try {
    const cfg = resolveAgentRuntimeConfig(runtimeConfig);
    mysqlDatabase = cfg.mysql.database;
    mysqlHost = cfg.mysql.host;
  } catch {
    mysqlDatabase = String(runtimeConfig?.mysql?.database ?? "");
    mysqlHost = String(runtimeConfig?.mysql?.host ?? "");
  }

  const env = getDbAgentBlueprintEnv();
  const patch = loadDomainPatch(env.domain);

  return {
    domain: env.domain,
    profile: env.profile,
    mysql_database: mysqlDatabase,
    mysql_host: mysqlHost,
    patch: {
      id: patch.id,
      hint_count: patch.blueprint.hints?.length ?? 0,
      has_schema_overrides: Boolean(Object.keys(patch.schemaOverrides).length),
      has_relations: Boolean(patch.relations.foot_pressure || patch.relations.join_hints?.length),
      has_domain_tools: Boolean(Object.keys(patch.domainTools.tables ?? {}).length),
      metrics_count: patch.metrics.length,
      default_time_ranges: Object.keys(patch.defaultTimeRanges),
    },
    features: {
      enableSqlDirect: env.enableSqlDirect,
      enableSqlPreflight: env.enableSqlPreflight,
      enableSchemaTableJudge: env.enableSchemaTableJudge,
      enableQueryIr: env.enableQueryIr,
      enableTaskStack: env.enableTaskStack,
      agentFallbackOnlyOnHardFail: env.agentFallbackOnlyOnHardFail,
      enableDomainSkills: env.enableDomainSkills,
      enableSqlPlanDirect: env.enableSqlPlanDirect,
      enableSqlTemplateDirect: env.enableSqlTemplateDirect,
      enableExperienceSqlDirect: env.enableExperienceSqlDirect,
      enableMetricsDirect: env.enableMetricsDirect,
      enableSchemaFirstRoute: env.enableSchemaFirstRoute,
      enableStructuralPlan: env.enableStructuralPlan,
    },
  };
});
