import { parseQueryPlan } from "../nlu";
import { parseManagerDbTaskFromJson } from "../manager_task_context";
import { safeParseSqlPreflightJson } from "../sql_preflight";
import type { SchemaGroundResult } from "../schema_ground";
import type { SkillRunContext } from "../skills";
import type { DbGraphSkillState } from "./types";

export function createSkillRunCtx(): (state: DbGraphSkillState) => SkillRunContext {
  return (state) => {
    const sq = String(state.standalone_question || state.question || "").trim();
    const pre = safeParseSqlPreflightJson(String(state.sql_preflight_json || ""), sq);
    let schemaGround: SchemaGroundResult | null = null;
    try {
      const raw = String(state.schema_ground_json || "").trim();
      if (raw) schemaGround = JSON.parse(raw) as SchemaGroundResult;
    } catch {
      schemaGround = null;
    }
    let routeHint = "";
    try {
      const rp = String(state.route_policy_json || "").trim();
      if (rp) routeHint = (JSON.parse(rp) as { hintBlock?: string })?.hintBlock || "";
    } catch {
      routeHint = "";
    }
    if (!routeHint && schemaGround?.table_judge_hint) routeHint = schemaGround.table_judge_hint;
    return {
      queryPlan: parseQueryPlan(state.query_plan_json),
      schemaSearchHint: (pre?.schema_search_keywords || schemaGround?.search_keywords || "").trim() || sq,
      sqlPreflight: pre ?? undefined,
      managerTask: parseManagerDbTaskFromJson(String(state.manager_task_json || "")),
      schemaGround,
      routeHint: routeHint || undefined,
    };
  };
}
