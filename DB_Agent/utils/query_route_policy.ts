/**
 * P4 路径策略：在 NL 理解（QueryPlan）与 Schema 接地之后，选择最可能「查对数据」的执行路径。
 * 对标总管 routeStrategy，聚焦问句类型 → sql_direct / person_health / sql_agent 等路径的学习与决策。
 * SSOT 原则文档：skills/route_policy/skill.md（运行时算法见 utils/route/）。
 *
 * @deprecated 请从 `./route` 导入；本文件为向后兼容 shim。
 */
export {
  type RouteExecutionPath,
  type SchemaPlanAlignment,
  type RouteDecision,
  analyzeSchemaPlanAlignment,
  refineQueryPlanWithSchema,
  isPersonEntityPlan,
  resolvePersonNameFromPlanOrQuestion,
  formatRouteProgressLabel,
  formatRouteHintBlock,
  buildRouteDecision,
  refreshRoutePreferencesFromSignals,
  getRoutePreferencesSummary,
  inferCausalFailureTag,
  recordRouteDecisionOutcome,
  clearRoutePreferences,
} from "./route";
