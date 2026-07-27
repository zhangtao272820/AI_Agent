/**
 * 结构化 SQL 快路径：Preflight + Schema 接地后，强模型一次生成 SELECT，失败则交 ReAct Agent。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { EmbeddingClientConfig } from "../../agent";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import type { DataSource } from "typeorm";
import { clipText } from "../../nlu/text";
import type { QueryPlan } from "../../nlu/query_plan";
import { formatQueryPlanForSqlAgent } from "../../nlu/query_plan";
import type { SqlPreflightResult } from "../../sql_preflight";
import { formatSqlPreflightForSqlAgent } from "../../sql_preflight";
import { formatSchemaGroundForAgent, type SchemaGroundResult } from "../../schema_ground";
import { formatExperienceBlockForAgentAsync } from "../../query_learning";
import { formatSqlTemplateBlockForAgent, recordSqlTemplate, trySqlTemplateDirect } from "../../query_sql_templates";
import { buildJoinContextBlock } from "../../join_path";
import { formatUserPreferencesBlock } from "../../user_preferences";
import { getPromptPatchesForStage } from "../../prompt_evolution";
import { getDbAgentBlueprintEnv } from "../../db_agent_env";
import {
  extractSqlFromLlmOutput,
  isReadOnlySelectSql,
  prepareSelectForExecution,
  sqlDirectSystemPrompt,
  SQL_DIRECT_HUMAN_TEMPLATE,
  validateGeneratedSelectSql,
  formatSqlValidationFailure,
} from "../../sql";
import { runExplainPreflight } from "../../sql_explain_util";
import { getRunMeta, recordQueryMetric, setRunMeta, stashExplainPreflight, stashQueryTier } from "../../query_metrics";
import { formatFieldValueForUser } from "../../display_values";
import { resolvePersonNameFromPlanOrQuestion, isPersonEntityPlan } from "../../query_route_policy";
import { guessTablesFromSql } from "../../sql_plan_guard";
import { linkColumnsToQueryIr } from "../../nlu/dbColumnLinkLlm";
import {
  formatExecutionShapeForSqlAgent,
  type QueryExecutionShape,
} from "../../nlu/dbQueryExecutionShapeLlm";
import { isEnumerateRowsMode, dedupeEnumerateRows, enumerateRowLimit, detailEnumerateRowsLookIncomplete } from "../../nlu/dbSchemaLinkResultMode";
import { hasNegativeFeedbackForQuestion, shouldBypassFastPathsForQuestion } from "../../query_learning";
import { pickDisplayColumnsByLlm } from "../../nlu/dbResultColumnLlm";
import { pickColumnsByPlanMetrics, formatSingleScalarValue } from "../../nlu/dbAnswerFormat";
import { shouldRunResultColumnLlm } from "../../nlu/dbModelRouter";
import { compileSchemaLinkToSql, tryScalarSchemaLinkedQuery } from "../../scalar_sql_builder";
import { resolveQueryTier, shouldUseQueryIrPath } from "../../nlu/dbComplexityLlm";
import { compileQueryIrToSql } from "../../query_ir";
import { repairSqlWithLlm } from "../../sql_repair";
import { incrementLlmCallCount } from "../../llm_call_counter";
import { trySqlPlanDirect } from "../../sql_plan_direct";
import {
  loadTablesMeta,
  queryPlanWantsFootAreaDetail,
  discoverSchemaRelations,
  tableNameLooksLikeFootPressure,
  tableNameLooksLikeNursingChronic,
  tableNameLooksLikePersonHealthRecords,
  tryPersonHealthJoinQuery,
  tryPrimaryTableDetailByName,
} from "../../schema_relations";
import { getMustTablesForDataDomain, getHealthLinkTables } from "../../domain_patch";
import {
  collectDetailFastPathIntentTokens,
  rankDetailTablesByIntent,
} from "../../detail_fastpath_align";
import {
  planMentionsFootPressure,
  questionMentionsFootPressure,
  tryFootPressureFastPath,
} from "../../foot_pressure_fastpath";
import { tryMetricsDirect } from "../../metrics_compiler";
import { tryGenericStatistics } from "../../generic_statistics";
import { runPersonInfoStatsFastPath } from "../../person";

import { sanitizeAssistantText } from "../../text";
import type { SqlDirectResult } from "./types";
import { formatRowsForUser, wrapSqlDirectAnswer } from "./answerFormat";

export function planWantsFullRecordFields(
  plan?: QueryPlan | null,
  question?: string,
  executionShape?: QueryExecutionShape | null,
): boolean {
  if (executionShape === "scalar_lookup") return false;
  if (question && questionMentionsFootPressure(question)) return true;
  if (planMentionsFootPressure(plan)) return true;
  if (!plan) return false;
  if (plan.intent === "detail") return true;
  if (executionShape === "detail_rows") return true;
  return false;
}

export function sqlLooksLikePartialDetailSelect(sql: string): boolean {
  const s = String(sql ?? "").replace(/\s+/g, " ").trim();
  if (!/\bselect\b/i.test(s) || /\bselect\s+\*/i.test(s)) return false;
  const m = s.match(/\bselect\s+([\s\S]+?)\s+from\b/i);
  if (!m?.[1]) return false;
  const cols = m[1]
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return cols.length > 0 && cols.length < 14;
}

export async function runSqlDirectDetailFastPath(params: {
  ds: DataSource;
  question: string;
  queryPlan?: QueryPlan | null;
  schemaGround?: SchemaGroundResult | null;
  executionShape?: QueryExecutionShape | null;
}): Promise<SqlDirectResult | null> {
  if (!planWantsFullRecordFields(params.queryPlan, params.question, params.executionShape)) return null;
  if (queryPlanWantsFootAreaDetail(params.queryPlan)) return null;
  if (!isPersonEntityPlan(params.queryPlan)) return null;

  const personName = resolvePersonNameFromPlanOrQuestion(params.queryPlan ?? ({} as QueryPlan), params.question);
  if (!personName) return null;

  const judge = params.schemaGround?.table_judge;
  const candidates = params.schemaGround?.candidate_tables ?? [];
  const auxiliary = new Set(judge?.auxiliary_tables ?? []);
  const ordered = (judge?.ranked_tables?.length ? judge.ranked_tables : candidates).filter(
    (t) => t && !auxiliary.has(t),
  );
  if (!ordered.length) return null;

  // 多表候选时必须已有表 judge，否则交给 sql_direct / sql_agent 全链路判断
  if (candidates.length > 1 && !judge?.primary_tables?.length) return null;

  const intentTokens = collectDetailFastPathIntentTokens(params.question, params.queryPlan);
  let tablesToTry = ordered.slice(0, 4);

  if (intentTokens.length) {
    const metas = await loadTablesMeta(params.ds, ordered.slice(0, 6));
    const aligned = rankDetailTablesByIntent(metas, intentTokens, ordered);
    if (!aligned.length) return null;
    const top = aligned[0]!.score;
    tablesToTry = aligned.filter((x) => x.score >= top - 1).map((x) => x.name);
  } else if (judge?.primary_tables?.length) {
    tablesToTry = judge.primary_tables.filter((t) => t && !auxiliary.has(t)).slice(0, 2);
  }

  let hit: Awaited<ReturnType<typeof tryPrimaryTableDetailByName>> = null;
  for (const table of tablesToTry) {
    hit = await tryPrimaryTableDetailByName(params.ds, { table, personName, limit: 5 });
    if (hit?.rows?.length) break;
    hit = null;
  }
  if (!hit?.rows?.length) return null;

  const body = await formatRowsForUser(params.ds, hit.rows, {
    sql: hit.sql,
    schemaGround: params.schemaGround,
    maxRows: 10,
  });
  const answer = sanitizeAssistantText(
    body ? wrapSqlDirectAnswer(body, hit.rows.length, "detail") : "查询已完成，但未返回可展示字段。",
  );
  return { ok: true, answer, sql: hit.sql, rowCount: hit.rows.length };
}
