/**
 * P0-2：单次 LLM 合并 sql_preflight + sql_direct（省 1 次编排调用）。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { z } from "zod";
import { clipText } from "./nlu/text";
import type { QueryPlan } from "./nlu/query_plan";
import { formatQueryPlanForSqlAgent } from "./nlu/query_plan";
import type { SqlPreflightResult } from "./sql_preflight";
import { normalizeSqlPreflight } from "./sql_preflight";
import { formatSchemaGroundForAgent, type SchemaGroundResult } from "./schema_ground";
import { buildJoinContextBlock } from "./join_path";
import { formatExecutionShapeForSqlAgent, type QueryExecutionShape } from "./nlu/dbQueryExecutionShapeLlm";
import { getDbAgentBlueprintEnv } from "./db_agent_env";
import { incrementLlmCallCount } from "./llm_call_counter";
import { sqlPlanDirectSystemPrompt } from "./sql/prompts";
import { extractSqlFromLlmOutput } from "./sql_safety";

const PlanDirectSchema = z.object({
  refined_question: z.string().optional(),
  schema_search_keywords: z.string().optional(),
  sql_intent_summary: z.string().optional(),
  must_filters: z.array(z.string()).max(12).optional(),
  risk_notes: z.array(z.string()).max(8).optional(),
  sql: z.string().optional(),
  clarify: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type SqlPlanDirectHit = {
  sql: string;
  preflight: SqlPreflightResult;
};

function safeJsonParse(text: string): unknown {
  const s = String(text ?? "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

const PLAN_DIRECT_SYSTEM = sqlPlanDirectSystemPrompt();

export function isSqlPlanDirectEnabled(): boolean {
  return getDbAgentBlueprintEnv().enableSqlPlanDirect;
}

export async function trySqlPlanDirect(params: {
  model: BaseLanguageModel;
  question: string;
  queryPlan?: QueryPlan | null;
  preflight?: SqlPreflightResult | null;
  schemaGround?: SchemaGroundResult | null;
  routeHint?: string;
  executionShape?: QueryExecutionShape | null;
}): Promise<SqlPlanDirectHit | { clarify: string } | null> {
  if (!isSqlPlanDirectEnabled()) return null;
  const q = String(params.question ?? "").trim();
  if (!q) return null;

  const schemaBlock = formatSchemaGroundForAgent(params.schemaGround);
  if (!schemaBlock.trim()) return null;

  const planBlock = formatQueryPlanForSqlAgent(params.queryPlan);
  const joinBlock = buildJoinContextBlock({
    tables: params.schemaGround?.candidate_tables ?? [],
    relations: params.schemaGround?.relations,
    queryPlan: params.queryPlan,
  });
  const routeBlock = String(params.routeHint ?? "").trim();
  const env = getDbAgentBlueprintEnv();
  const shapeBlock = formatExecutionShapeForSqlAgent(params.executionShape);
  const context = clipText(
    [planBlock, shapeBlock, joinBlock, routeBlock, schemaBlock].filter(Boolean).join("\n\n"),
    env.sqlDirectMaxContextChars,
  );

  try {
    const res = await params.model.invoke([
      ["system", PLAN_DIRECT_SYSTEM],
      ["human", `上下文：\n${context}\n\n用户问题：\n${q.slice(0, 800)}`],
    ]);
    incrementLlmCallCount(1);
    const raw = String((res as { content?: string })?.content ?? "");
    const parsed = PlanDirectSchema.safeParse(safeJsonParse(raw));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.4) return null;

    const clarify = String(parsed.data.clarify ?? "").trim();
    if (clarify && !String(parsed.data.sql ?? "").trim()) return { clarify };

    const preflight = normalizeSqlPreflight(parsed.data, q, params.queryPlan);
    let sql = extractSqlFromLlmOutput(String(parsed.data.sql ?? "").trim() || raw);
    if (!sql && parsed.data.sql) sql = String(parsed.data.sql).trim();
    if (!sql) return null;

    return { sql, preflight };
  } catch {
    return null;
  }
}
