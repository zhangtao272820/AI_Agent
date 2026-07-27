/**
 * generic_statistics 纯函数：主表优先 + 过滤计划禁裸 GROUP BY。
 */
import { orderTablesForGenericStats, planHasBusinessFilters } from "./generic_statistics_policy";
import type { QueryPlan } from "./nlu/query_plan";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const emptyPlan = {
  intent: "aggregation",
  subject: "person",
  data_domain: "person_basic",
  confidence: 0.8,
  entities: { names: [], locations: [], orgs: [], ids: [], records: [], dates: [] },
  metrics: ["人数"],
  dimensions: ["性别"],
  filters: { time_range: { start: "", end: "", relative: "" }, where: [], slots: [] },
  missing_slots: [],
  needs_clarification: false,
  clarification_question: "",
  sort: [],
  limit: 20,
} as QueryPlan;

assert(!planHasBusinessFilters(emptyPlan), "no location/slots → no business filters");

const filtered = {
  ...emptyPlan,
  entities: { ...emptyPlan.entities, locations: ["河西区"] },
  filters: {
    ...emptyPlan.filters,
    slots: [{ field_hint: "age_gte", value: "70", sql_match_value: "70" }],
  },
} as QueryPlan;
assert(planHasBusinessFilters(filtered), "location+age slots → business filters");

const ordered = orderTablesForGenericStats({
  candidateTables: ["sys_user", "remote_psychology_mood", "person_info"],
  primaryTables: ["person_info"],
  rankedTables: ["person_info", "sys_user"],
});
assert(ordered[0] === "person_info", `primary first, got ${ordered.join(",")}`);

const noPrimary = orderTablesForGenericStats({
  candidateTables: ["sys_user", "person_info"],
  primaryTables: [],
});
assert(noPrimary[0] === "sys_user", "without primary keep candidate order");

console.log("ok: generic_statistics");
