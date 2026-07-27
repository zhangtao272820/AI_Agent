import { needsCondenseStructural } from "./dbCondenseLlm";

export function needsCondense(question: string) {
  return needsCondenseStructural(question);
}

const ROUTER_SKILL_IDS = [
  "person_health",
  "person_info",
  "statistics",
  "help",
  "out_of_scope",
  "sql_agent",
] as const;

export function normalizeIntent(text: string) {
  const raw = String(text ?? "").trim().toLowerCase();
  const t = raw.replace(/[`"'“”]/g, "").replace(/\s+/g, " ");
  for (const id of ROUTER_SKILL_IDS) {
    if (t.includes(id)) return id;
  }
  if (t === "person") return "person_info";
  if (t.includes("health")) return "person_health";
  if (t.includes("statistic") || t.includes("statistics")) return "statistics";
  if (t.includes("out") && t.includes("scope")) return "out_of_scope";
  return "sql_agent";
}

export function inferIntentHeuristic(_question: string, _domainEnabled: boolean) {
  /** @deprecated 业务 intent 由 QueryPlan LLM + routingChain 判定，不再用关键词正则 */
  return null
}

export function getRouterRuleLines(domainEnabled: boolean) {
  const lines: string[] = [];
  if (domainEnabled) lines.push("- 当问题明确是“单个人”的基础信息或健康信息时，可优先选择 person_info 或 person_health");
  lines.push("- 当问题需要读取数据库表结构/字段注释/样例数据来确定表与列时，选择 sql_agent");
  lines.push("- 如果问题明显不属于以上任何业务分类，且不涉及当前业务库数据查询，请选择 out_of_scope");
  return lines;
}
