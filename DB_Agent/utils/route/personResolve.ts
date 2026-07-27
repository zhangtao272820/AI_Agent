import type { QueryPlan } from "../nlu/query_plan";
import { resolveNameCandidates } from "../nlu/signals";
import { extractPersonName } from "../tools";

/** Plan 是否明确在查「人员」实体（姓名启发仅在此类问句启用，避免把指标/问句片段当人名）。 */
export function isPersonEntityPlan(plan?: QueryPlan | null): boolean {
  if (!plan) return false;
  if (plan.subject === "person") return true;
  return plan.data_domain === "person_basic" || plan.data_domain === "person_health";
}

/** 从 plan 或问句解析人员姓名（供健康/人员快路径；非人员 Plan 不启发提名，交给 LLM SQL）。 */
export function resolvePersonNameFromPlanOrQuestion(
  plan: QueryPlan,
  question?: string,
): string {
  const fromPlan = (plan.entities?.names ?? []).map((n) => String(n ?? "").trim()).find(Boolean);
  if (fromPlan) return fromPlan;
  if (!isPersonEntityPlan(plan)) return "";
  const q = String(question ?? "").trim();
  if (!q) return "";
  return resolveNameCandidates(plan, q)[0] || extractPersonName(q) || "";
}
