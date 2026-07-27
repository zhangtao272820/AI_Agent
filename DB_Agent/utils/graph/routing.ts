import { END } from "@langchain/langgraph";
import { getDbAgentBlueprintEnv } from "../db_agent_env";
import { parseQueryPlan } from "../nlu";
import { parseTaskStackJson } from "../task_stack";
import type { DbGraphDeps } from "./types";

export function afterRepeat(state: { answer?: string }) {
  return state.answer ? END : "condense";
}

export function afterPlan(state: {
  clarification_question?: string;
  task_stack_json?: string;
  query_plan_json?: string;
}) {
  const q = String(state?.clarification_question || "").trim();
  if (q) return "clarify";
  const stack = parseTaskStackJson(String(state?.task_stack_json || ""));
  if (stack?.steps.length) return "task_stack";
  const plan = parseQueryPlan(String(state.query_plan_json || ""));
  if (plan.intent === "out_of_scope") return "out_of_scope";
  return "schema_ground";
}

export function afterSqlDirect(state: { answer?: string }) {
  const ans = String(state?.answer || "").trim();
  if (ans) return END;
  return "sql_agent";
}

export function buildAfterRoute(skills: DbGraphDeps["skills"]) {
  return (state: {
    route_policy_json?: string;
    intent?: string;
  }) => {
    let routePath = "";
    try {
      const rp = String(state.route_policy_json || "").trim();
      if (rp) routePath = String((JSON.parse(rp) as { executionPath?: string }).executionPath || "");
    } catch {
      routePath = "";
    }
    const intent = String(state.intent || "sql_agent");
    const env = getDbAgentBlueprintEnv();

    if (intent === "help") return "help";
    if (intent === "out_of_scope") return "out_of_scope";

    if (env.enableSchemaFirstRoute) {
      if (env.enableDomainSkills && routePath === "person_info" && skills.person_info.enabled !== false) {
        return "person_info";
      }
      if (env.enableDomainSkills && routePath === "person_health" && skills.person_health.enabled !== false) {
        return "person_health";
      }
      if (routePath === "statistics" && skills.statistics.enabled !== false) return "statistics";
      if (env.enableSqlPreflight && !env.enableSqlPlanDirect) return "sql_preflight";
      if (env.enableSqlDirect) return "sql_direct";
      return "sql_agent";
    }

    if (
      routePath === "person_info" ||
      (intent === "person_info" && routePath !== "sql_preflight" && routePath !== "sql_agent")
    ) {
      if (skills.person_info.enabled !== false) return "person_info";
    }
    if (routePath === "person_health" && skills.person_health.enabled !== false) return "person_health";
    if (intent === "statistics" && skills.statistics.enabled !== false) return "statistics";
    if (routePath === "sql_preflight" || routePath === "sql_agent" || routePath === "statistics") {
      if (routePath === "statistics" && skills.statistics.enabled !== false) return "statistics";
      if (env.enableSqlPreflight && !env.enableSqlPlanDirect) return "sql_preflight";
      if (env.enableSqlDirect) return "sql_direct";
      return "sql_agent";
    }
    if (intent === "person_health" && skills.person_health.enabled !== false) return "person_health";
    if (env.enableSqlPreflight && !env.enableSqlPlanDirect) return "sql_preflight";
    if (env.enableSqlDirect) return "sql_direct";
    return "sql_agent";
  };
}
