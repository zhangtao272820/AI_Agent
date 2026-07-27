import { clipText } from "../nlu/text";
import type { QueryPlan } from "../nlu/query_plan";
import { inferQueryTierStructural, type QueryTier } from "../nlu/dbComplexityLlm";
import type { SchemaGroundResult } from "../schema_ground";
import { getDbAgentBlueprintEnv } from "../db_agent_env";
import { analyzeSchemaPlanAlignment, refineQueryPlanWithSchema } from "./alignment";
import { applyRouteSkillGates, buildContextKey, pickExecutionPath } from "./pickPath";
import { readRoutePrefs } from "./preferences";
import type { RouteDecision } from "./types";

/** 思考过程 / UI 用的路径策略文案 */
export function formatRouteProgressLabel(decision: RouteDecision): string {
  const path = decision.executionPath;
  const reason = decision.reasons[0] || "已对齐 schema";
  if (path === "person_health") return `健康体征连表（${reason}）`;
  if (path === "person_info") return `人员档案（${reason}）`;
  if (path === "statistics") return `统计分析（${reason}）`;
  if (path === "sql_agent" || decision.skipSqlDirect) return `深度 SQL（${reason}）`;
  if (decision.alignment.hasFootPressureTable) return `检测/活动明细 SQL（${reason}）`;
  return `结构化 SQL（${reason}）`;
}

export function formatRouteHintBlock(decision: RouteDecision): string {
  const lines = ["[路径策略]（理解对齐与执行建议，编写 SQL 时须遵守）"];
  for (const r of decision.reasons.slice(0, 4)) lines.push(`- ${r}`);
  if (decision.alignment.domainMismatch && decision.refinedPlan.data_domain === "person_health") {
    lines.push("- 已根据 schema 将数据域升级为 person_health，必须 JOIN 健康明细表");
  }
  if (decision.alignment.causalTags.length) {
    lines.push(`- 对齐标签：${decision.alignment.causalTags.join("、")}`);
  }
  if (decision.refinedPlan.entities.names.length) {
    lines.push(`- 目标人员：${decision.refinedPlan.entities.names.join("、")}`);
  }
  if (decision.refinedPlan.metrics.length) {
    lines.push(`- 关注指标：${decision.refinedPlan.metrics.join("、")}`);
  }
  return clipText(lines.join("\n"), 520);
}

export function buildRouteDecision(input: {
  question: string;
  plan: QueryPlan;
  schemaGround: SchemaGroundResult | null | undefined;
  queryTier?: QueryTier | null;
}): RouteDecision {
  const tableJudge = input.schemaGround?.table_judge ?? null;
  const alignment = analyzeSchemaPlanAlignment(input.plan, input.schemaGround);

  if (input.plan.intent === "out_of_scope") {
    return {
      intent: "out_of_scope",
      executionPath: "sql_agent",
      refinedPlan: input.plan,
      reasons: ["Plan 判定与业务库无关或无需查库"],
      alignment,
      skipSqlDirect: true,
      contextKey: buildContextKey(input.plan, alignment),
      pathScores: {},
      hintBlock: "",
    };
  }

  const refinedPlan = refineQueryPlanWithSchema(input.plan, alignment, tableJudge);
  const contextKey = buildContextKey(refinedPlan, alignment);
  const prefs = readRoutePrefs().rows;
  const env = getDbAgentBlueprintEnv();
  const tierStructural = inferQueryTierStructural(input.question, refinedPlan);
  const queryTier = input.queryTier ?? tierStructural?.tier ?? null;
  let { path, scores, reasons } = pickExecutionPath(
    refinedPlan,
    alignment,
    prefs,
    contextKey,
    input.question,
    queryTier,
    tableJudge,
    { schemaFirst: env.enableSchemaFirstRoute, domainSkills: env.enableDomainSkills },
  );

  path = applyRouteSkillGates(path, reasons, alignment, refinedPlan, tableJudge);

  if (alignment.domainMismatch && alignment.suggestedDataDomain) {
    reasons.unshift(`数据域 ${input.plan.data_domain}→${refinedPlan.data_domain}（schema 对齐）`);
  }

  let intent = "sql_agent";
  if (path === "person_health") intent = "person_health";
  else if (path === "person_info") intent = "person_info";
  else if (path === "statistics") intent = "statistics";
  else if (path === "sql_agent" || path === "sql_preflight") intent = "sql_agent";

  const skipSqlDirect = path === "sql_agent";

  const decision: RouteDecision = {
    intent,
    executionPath: path,
    refinedPlan,
    reasons,
    alignment,
    skipSqlDirect,
    contextKey,
    pathScores: scores,
    hintBlock: "",
  };
  decision.hintBlock = formatRouteHintBlock(decision);
  return decision;
}
