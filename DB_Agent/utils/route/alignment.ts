import type { QueryPlan } from "../nlu/query_plan";
import {
  tableNameLooksLikeFootPressure,
  tableNameLooksLikeNursingChronic,
  tableNameLooksLikePersonHealthRecords,
} from "../schema_relations";
import type { SchemaGroundResult } from "../schema_ground";
import { inferDataDomainFromSchema } from "../schema_domain_align";
import type { SchemaTableJudgeResult } from "../schema_table_judge";
import type { SchemaPlanAlignment } from "./types";

export function analyzeSchemaPlanAlignment(
  plan: QueryPlan,
  ground: SchemaGroundResult | null | undefined,
): SchemaPlanAlignment {
  const tables = (ground?.candidate_tables ?? []).filter(Boolean);
  const relations = ground?.relations ?? [];
  const judge = ground?.table_judge;

  let hasPersonHealthRecords = tables.some((t) => tableNameLooksLikePersonHealthRecords(t));
  const hasFootPressureTable =
    tables.some((t) => tableNameLooksLikeFootPressure(t)) ||
    (judge?.primary_tables ?? []).some((t) => tableNameLooksLikeFootPressure(t));

  let hasHealthTable = hasPersonHealthRecords;
  let hasPersonMaster = false;
  let hasHealthJoin = relations.some(
    (r) =>
      tableNameLooksLikePersonHealthRecords(r.from_table) ||
      tableNameLooksLikePersonHealthRecords(r.to_table),
  );

  if (judge) {
    const primaryTables = judge.primary_tables ?? [];
    const auxiliaryTables = judge.auxiliary_tables ?? [];
    hasPersonMaster = primaryTables.length > 0;
    if (!hasPersonHealthRecords) {
      hasPersonHealthRecords =
        auxiliaryTables.some((t) => tableNameLooksLikePersonHealthRecords(t)) ||
        primaryTables.some((t) => tableNameLooksLikePersonHealthRecords(t));
      hasHealthTable = hasPersonHealthRecords;
    }
    if (!hasHealthJoin) {
      hasHealthJoin =
        hasPersonHealthRecords &&
        (relations.length > 0 || auxiliaryTables.some((t) => tableNameLooksLikePersonHealthRecords(t)));
    }
  } else {
    hasPersonMaster = tables.length > 0;
    if (!hasHealthJoin && hasPersonHealthRecords) {
      hasHealthJoin = relations.some(
        (r) =>
          tableNameLooksLikePersonHealthRecords(r.from_table) ||
          tableNameLooksLikePersonHealthRecords(r.to_table),
      );
    }
  }

  const causalTags: string[] = [];
  let domainMismatch = false;
  let suggestedDataDomain: QueryPlan["data_domain"] | undefined;

  const planWantsHealth = plan.data_domain === "person_health";
  const planWantsBasic = plan.data_domain === "person_basic";
  const planHasHealthMetrics = plan.metrics.length > 0 && planWantsHealth;

  if (planWantsHealth && !hasHealthTable) {
    causalTags.push("schema_missing_health_table");
  }
  if (planWantsHealth && hasHealthTable && !hasHealthJoin) {
    causalTags.push("schema_missing_health_join");
  }
  const primary = (judge?.primary_tables ?? []).filter(Boolean);
  const nursingPrimary = primary.some((t) => tableNameLooksLikeNursingChronic(t));
  if (planWantsHealth && nursingPrimary) {
    domainMismatch = true;
    suggestedDataDomain = "general";
    causalTags.push("schema_judge_primary_not_health");
  }
  if (planWantsBasic && hasPersonHealthRecords && hasHealthJoin && planHasHealthMetrics) {
    domainMismatch = true;
    suggestedDataDomain = "person_health";
    causalTags.push("plan_domain_too_narrow");
  }

  let schemaConfidence = 0.35;
  if (tables.length) schemaConfidence += 0.15;
  if (hasPersonMaster) schemaConfidence += 0.15;
  if (planWantsHealth && hasHealthTable && hasHealthJoin) schemaConfidence += 0.25;
  if (planWantsBasic && hasPersonMaster && !hasHealthTable) schemaConfidence += 0.2;
  schemaConfidence = Math.min(1, schemaConfidence);

  if (hasFootPressureTable && planWantsHealth) {
    causalTags.push("schema_foot_not_health_domain");
  }

  return {
    hasHealthTable,
    hasPersonMaster,
    hasHealthJoin,
    hasPersonHealthRecords,
    hasFootPressureTable,
    domainMismatch,
    suggestedDataDomain,
    causalTags,
    schemaConfidence,
  };
}

/** 用 schema 接地结果修正 plan（P0-8 schema-first：域由表链接推断）。 */
export function refineQueryPlanWithSchema(
  plan: QueryPlan,
  alignment: SchemaPlanAlignment,
  tableJudge?: SchemaTableJudgeResult | null,
): QueryPlan {
  let next = { ...plan };

  const preservePersonBasicStats =
    plan.data_domain === "person_basic" &&
    plan.subject === "person" &&
    (plan.entities?.locations?.length ?? 0) > 0 &&
    ["aggregation", "comparison"].includes(plan.intent);

  const schemaDomain = inferDataDomainFromSchema({ plan: next, alignment, tableJudge });
  if (next.data_domain === "general" || next.data_domain !== schemaDomain) {
    next = { ...next, data_domain: schemaDomain };
    if (schemaDomain === "person_health" && next.subject === "unknown") next.subject = "person";
    if (schemaDomain === "person_basic" && next.subject === "unknown") next.subject = "person";
  }

  if (preservePersonBasicStats && next.data_domain === "general") {
    next = { ...next, data_domain: "person_basic", subject: "person" };
  }

  if (
    next.data_domain === "person_health" &&
    alignment.hasFootPressureTable &&
    !alignment.hasPersonHealthRecords
  ) {
    next = { ...next, data_domain: "general" };
  }

  const nursingPrimary = (tableJudge?.primary_tables ?? []).some((t) => tableNameLooksLikeNursingChronic(t));
  if (next.data_domain === "person_health" && nursingPrimary) {
    next = { ...next, data_domain: "general" };
  }

  if (alignment.domainMismatch && alignment.suggestedDataDomain) {
    if (
      alignment.suggestedDataDomain === "person_health" &&
      alignment.hasFootPressureTable &&
      !alignment.hasPersonHealthRecords
    ) {
      return next;
    }
    next = { ...next, data_domain: alignment.suggestedDataDomain };
    if (alignment.suggestedDataDomain === "person_health" && next.subject === "unknown") {
      next.subject = "person";
    }
    if (next.confidence < 0.72) next.confidence = Math.min(0.85, next.confidence + 0.12);
  }

  return next;
}

export function looksLikePersonHealthQuery(
  plan: QueryPlan,
  alignment: SchemaPlanAlignment,
  tableJudge?: SchemaTableJudgeResult | null,
): boolean {
  if (plan.data_domain !== "person_health") return false;
  const primary = (tableJudge?.primary_tables ?? []).filter(Boolean);
  if (primary.some((t) => tableNameLooksLikeNursingChronic(t))) return false;
  if (primary.length && !primary.some((t) => tableNameLooksLikePersonHealthRecords(t))) return false;
  if (alignment.hasFootPressureTable && !alignment.hasPersonHealthRecords) return false;
  return alignment.hasPersonHealthRecords || alignment.hasHealthJoin;
}
