import type { QueryPlan } from "../nlu/query_plan";
import type { QueryPath } from "../query_metrics";

export type RouteExecutionPath =
  | "person_health"
  | "person_info"
  | "statistics"
  | "sql_preflight"
  | "sql_agent";

export type SchemaPlanAlignment = {
  hasHealthTable: boolean;
  hasPersonMaster: boolean;
  hasHealthJoin: boolean;
  /** schema 已接地 person_health_records（体征档案，非足底等业务表） */
  hasPersonHealthRecords: boolean;
  /** schema 已接地足底压力/活动检测类表 */
  hasFootPressureTable: boolean;
  /** plan.data_domain 与 schema 暗示不一致 */
  domainMismatch: boolean;
  suggestedDataDomain?: QueryPlan["data_domain"];
  causalTags: string[];
  schemaConfidence: number;
};

export type RouteDecision = {
  intent: string;
  executionPath: RouteExecutionPath;
  refinedPlan: QueryPlan;
  hintBlock: string;
  reasons: string[];
  alignment: SchemaPlanAlignment;
  skipSqlDirect: boolean;
  contextKey: string;
  pathScores: Partial<Record<QueryPath, number>>;
};

export type RoutePreferenceRow = {
  contextKey: string;
  path: QueryPath;
  trials: number;
  successes: number;
  empty: number;
  avgMs: number;
};

export type RoutePreferencesFile = {
  updatedAt: string;
  rows: RoutePreferenceRow[];
};
