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
import { sanitizeAssistantText } from "../../text";
import { runExplainPreflight } from "../../sql_explain_util";
import { getRunMeta, recordQueryMetric, setRunMeta, stashExplainPreflight, stashQueryTier } from "../../query_metrics";
import { formatFieldValueForUser } from "../../display_values";
import { resolvePersonNameFromPlanOrQuestion, isPersonEntityPlan } from "../../query_route_policy";
import {
  guessTablesFromSql,
} from "../../sql_plan_guard";
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

import type { SqlDirectResult } from "./types";
import { runSqlDirectDetailFastPath } from "./detailFastPath";

/** 领域/全字段明细快路径：须在通用 Schema Link detail_rows 之前 */
export async function runDetailRecordFastPaths(params: {
  ds: DataSource;
  question: string;
  queryPlan?: QueryPlan | null;
  schemaGround?: SchemaGroundResult | null;
  executionShape?: QueryExecutionShape | null;
  managerContextBlob?: string;
}): Promise<SqlDirectResult | null> {
  const footFast = await tryFootPressureFastPath(params.ds, {
    question: params.question,
    plan: params.queryPlan,
    schemaGround: params.schemaGround,
    managerContextBlob: params.managerContextBlob,
    executionShape: params.executionShape,
    wantsCount: params.executionShape === "scalar_lookup",
  });
  if (footFast) {
    return {
      ok: true,
      answer: sanitizeAssistantText(footFast.answer),
      sql: footFast.sql,
      rowCount: footFast.rowCount,
    };
  }
  return runSqlDirectDetailFastPath({
    ds: params.ds,
    question: params.question,
    queryPlan: params.queryPlan,
    schemaGround: params.schemaGround,
    executionShape: params.executionShape,
  });
}
