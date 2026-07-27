/**
 * SQL 生成后统一校验与执行前准备（safety + plan/schema guard）。
 */
import type { QueryPlan } from "../nlu/query_plan";
import type { SqlPreflightResult } from "../sql_preflight";
import type { SchemaTableJudgeResult } from "../schema_table_judge";
import {
  enforceSelectLimit,
  extractSqlFromLlmOutput,
  injectMysqlMaxExecutionTimeHint,
  isReadOnlySelectSql,
  validateSelectSemantics,
} from "../sql_safety";
import {
  validateSqlAgainstPlanFilters,
  validateSqlAgainstSchemaJudge,
  type SqlPlanGuardResult,
} from "../sql_plan_guard";

export type SqlGuardContext = {
  queryPlan?: QueryPlan | null;
  preflight?: SqlPreflightResult | null;
  judge?: SchemaTableJudgeResult | null;
  tableComments?: Record<string, string>;
};

export type SqlValidationStage = "readonly" | "semantic" | "plan_guard" | "schema_guard";

export type SqlValidationResult =
  | { ok: true; sql: string }
  | { ok: false; stage: SqlValidationStage; reason: string; hint?: string; guard?: SqlPlanGuardResult };

export function validateGeneratedSelectSql(
  rawOrSql: string,
  ctx: SqlGuardContext,
  opts?: { extract?: boolean },
): SqlValidationResult {
  const extracted = opts?.extract === false ? String(rawOrSql ?? "").trim() : extractSqlFromLlmOutput(rawOrSql);
  const checked = isReadOnlySelectSql(extracted);
  if (!checked.ok) return { ok: false, stage: "readonly", reason: checked.reason };

  const semantic = validateSelectSemantics(checked.sql);
  if (!semantic.ok) return { ok: false, stage: "semantic", reason: semantic.reason };

  const planGuard = validateSqlAgainstPlanFilters(checked.sql, ctx.queryPlan, ctx.preflight);
  if (!planGuard.ok) {
    return { ok: false, stage: "plan_guard", reason: planGuard.reason, hint: planGuard.hint, guard: planGuard };
  }

  const schemaGuard = validateSqlAgainstSchemaJudge(
    checked.sql,
    ctx.judge,
    ctx.queryPlan,
    ctx.tableComments,
  );
  if (!schemaGuard.ok) {
    return { ok: false, stage: "schema_guard", reason: schemaGuard.reason, hint: schemaGuard.hint, guard: schemaGuard };
  }

  return { ok: true, sql: checked.sql };
}

export function prepareSelectForExecution(
  sql: string,
  rowLimit: number,
  opts?: { maxLimit?: number; timeoutMs?: number },
): string {
  const maxLimit = opts?.maxLimit ?? 100;
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const limited = enforceSelectLimit(sql, maxLimit, rowLimit);
  return injectMysqlMaxExecutionTimeHint(limited, timeoutMs);
}

export function formatSqlValidationFailure(stage: SqlValidationStage, reason: string): string {
  if (stage === "readonly") return `sql_rejected:${reason}`;
  if (stage === "semantic") return `sql_semantic:${reason}`;
  return `sql_guard:${reason}`;
}
