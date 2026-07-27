/**
 * DB NLU 档位：DB_NLU_MODE 统一覆盖逐模块 DB_*_LLM 开关。
 * 显式 env 值仍优先于 preset（便于单模块调试）。
 */
export type DbNluMode = "full" | "minimal" | "off";

export type DbNluFeature =
  | "decompose"
  | "intent"
  | "condense"
  | "intent_rag"
  | "merged"
  | "query_slot"
  | "entity"
  | "filter_slot_map"
  | "execution_shape"
  | "clarify_gate"
  | "health_metric"
  | "plan_entity"
  | "result_column"
  | "schema_link"
  | "sql_output_shape"
  | "complexity"
  | "schema_column"
  | "task_stack"
  | "statistics_route"
  | "slot_schema_refine"
  | "plan_completeness";

const ENV_KEYS: Record<DbNluFeature, string> = {
  decompose: "DB_QUERY_DECOMPOSE_LLM",
  intent: "DB_QUERY_INTENT_LLM",
  condense: "DB_CONDENSE_LLM",
  intent_rag: "DB_INTENT_RAG",
  merged: "DB_MERGED_UNDERSTAND",
  query_slot: "DB_QUERY_SLOT_LLM",
  entity: "DB_ENTITY_LLM",
  filter_slot_map: "DB_FILTER_SLOT_MAP_LLM",
  execution_shape: "DB_QUERY_EXECUTION_SHAPE_LLM",
  clarify_gate: "DB_CLARIFY_GATE_LLM",
  health_metric: "DB_HEALTH_METRIC_LLM",
  plan_entity: "DB_PLAN_ENTITY_LLM",
  result_column: "DB_RESULT_COLUMN_LLM",
  schema_link: "DB_SCHEMA_LINK_LLM",
  sql_output_shape: "DB_SQL_OUTPUT_SHAPE_LLM",
  complexity: "DB_COMPLEXITY_LLM",
  schema_column: "DB_SCHEMA_COLUMN_LLM",
  task_stack: "DB_TASK_STACK_LLM",
  statistics_route: "DB_STATISTICS_ROUTE_LLM",
  slot_schema_refine: "DB_QUERY_SLOT_SCHEMA_REFINE",
  plan_completeness: "DB_PLAN_COMPLETENESS_LLM",
};

const ALL_FEATURES = Object.keys(ENV_KEYS) as DbNluFeature[];

const NLU_PRESETS: Record<DbNluMode, Record<DbNluFeature, boolean>> = {
  full: Object.fromEntries(ALL_FEATURES.map((f) => [f, true])) as Record<DbNluFeature, boolean>,
  minimal: {
    decompose: false,
    intent: true,
    condense: true,
    intent_rag: false,
    merged: false,
    query_slot: false,
    entity: false,
    filter_slot_map: false,
    execution_shape: true,
    clarify_gate: true,
    health_metric: false,
    plan_entity: false,
    result_column: false,
    schema_link: true,
    sql_output_shape: false,
    complexity: true,
    schema_column: false,
    task_stack: false,
    statistics_route: false,
    slot_schema_refine: false,
    plan_completeness: true,
  },
  off: Object.fromEntries(ALL_FEATURES.map((f) => [f, false])) as Record<DbNluFeature, boolean>,
};

function parseDbNluMode(raw: string): DbNluMode | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v === "off" || v === "0" || v === "false" || v === "no") return "off";
  if (v === "minimal" || v === "lite" || v === "fast") return "minimal";
  if (v === "full" || v === "on" || v === "1" || v === "default") return "full";
  return null;
}

export function resolveDbNluMode(env: NodeJS.ProcessEnv = process.env): DbNluMode {
  return parseDbNluMode(String(env.DB_NLU_MODE ?? "")) ?? "full";
}

export function dbNluFeatureEnvKey(feature: DbNluFeature): string {
  return ENV_KEYS[feature];
}

export function isDbNluFeatureEnabled(feature: DbNluFeature, env: NodeJS.ProcessEnv = process.env): boolean {
  const key = ENV_KEYS[feature];
  const raw = env[key];
  if (raw !== undefined && String(raw).trim() !== "") {
    return !/^(0|false|off|no)$/i.test(String(raw).trim());
  }
  return NLU_PRESETS[resolveDbNluMode(env)][feature];
}

/** 列出当前档位下各 feature 生效状态（供 /api/config 或 smoke） */
export function summarizeDbNluFeatures(env: NodeJS.ProcessEnv = process.env): Record<DbNluFeature, boolean> {
  const out = {} as Record<DbNluFeature, boolean>;
  for (const f of ALL_FEATURES) out[f] = isDbNluFeatureEnabled(f, env);
  return out;
}
