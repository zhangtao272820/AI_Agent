/**
 * 多节点编排：在 SQL Agent 前增加「自然语言 → 查询要点」结构化一步，提升选表与 WHERE 准确度。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { clipText } from "./nlu/text";
import { getDbAgentBlueprintEnv } from "./db_agent_env";
import { extractNameCandidatesFromQuestion } from "./nlu";
import { parseQueryPlan, type QueryPlan } from "./nlu/query_plan";
import { incrementLlmCallCount } from "./llm_call_counter";
import { sqlPreflightSystemPrompt } from "./sql/prompts";

export type SqlPreflightResult = {
  refined_question: string;
  schema_search_keywords: string;
  sql_intent_summary: string;
  must_filters: string[];
  risk_notes: string[];
};

const PREFLIGHT_SYSTEM = sqlPreflightSystemPrompt();

const PREFLIGHT_HUMAN = `用户问题（可含多轮上下文合并结果）：
{question}

上游查询计划 JSON 字符串：
{query_plan_json}

请只输出 JSON 对象，字段：refined_question, schema_search_keywords, sql_intent_summary, must_filters, risk_notes。`;

const preflightPrompt = ChatPromptTemplate.fromMessages([
  ["system", PREFLIGHT_SYSTEM],
  ["human", PREFLIGHT_HUMAN],
]);

export function fallbackPreflight(question: string): SqlPreflightResult {
  const q = String(question ?? "").trim();
  return {
    refined_question: q,
    schema_search_keywords: clipText(q.replace(/\s+/g, " "), 220),
    sql_intent_summary: "",
    must_filters: [],
    risk_notes: [],
  };
}

function asStrArray(v: unknown, maxLen: number, maxItems: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = clipText(String(x ?? "").trim(), maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** 将模型 JSON 规范为安全结构；失败时退回 fallback。 */
export function normalizeSqlPreflight(o: unknown, fallbackQ: string, plan?: QueryPlan | null): SqlPreflightResult {
  const fb = fallbackPreflight(fallbackQ);
  if (!o || typeof o !== "object") return mergePlanNamesIntoPreflight(fb, plan, fallbackQ);
  const r = o as Record<string, unknown>;
  let refined = clipText(String(r.refined_question ?? "").trim(), 600) || fb.refined_question;
  let keywords = clipText(String(r.schema_search_keywords ?? "").trim(), 220) || fb.schema_search_keywords;
  const summary = clipText(String(r.sql_intent_summary ?? "").trim(), 120);

  const nameHints = extractNameCandidatesFromQuestion(fallbackQ).filter((n) => String(n).trim().length >= 2);
  const planNames = (plan?.entities?.names ?? []).map((n) => String(n).trim()).filter((n) => n.length >= 2);
  const allNames = Array.from(new Set([...planNames, ...nameHints]));

  if (allNames.length) {
    const refinedMissesAll = allNames.every((n) => !refined.includes(n));
    if (refinedMissesAll) refined = fb.refined_question;
    const kwMissing = allNames.filter((n) => !keywords.includes(n));
    if (kwMissing.length) {
      keywords = clipText(`${kwMissing.join(" ")} ${keywords}`.replace(/\s+/g, " ").trim(), 220);
    }
  }
  const base: SqlPreflightResult = {
    refined_question: refined,
    schema_search_keywords: keywords,
    sql_intent_summary: summary,
    must_filters: asStrArray(r.must_filters, 80, 8),
    risk_notes: asStrArray(r.risk_notes, 100, 5),
  };
  return mergePlanNamesIntoPreflight(base, plan, fallbackQ);
}

function mergePlanNamesIntoPreflight(pre: SqlPreflightResult, plan: QueryPlan | null | undefined, fallbackQ: string): SqlPreflightResult {
  const names = Array.from(
    new Set([
      ...(plan?.entities?.names ?? []).map((n) => String(n).trim()).filter((n) => n.length >= 2),
      ...extractNameCandidatesFromQuestion(fallbackQ).filter((n) => n.length >= 2),
    ]),
  );
  if (!names.length) return pre;
  const must = [...(pre.must_filters ?? [])];
  for (const name of names) {
    const hasName = must.some((f) => f.includes(name));
    if (!hasName) must.push(`人员姓名=${name}`);
  }
  return { ...pre, must_filters: must.slice(0, 8) };
}

export function safeParseSqlPreflightJson(raw: string, fallbackQ: string, plan?: QueryPlan | null): SqlPreflightResult | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  try {
    const o = JSON.parse(t);
    return normalizeSqlPreflight(o, fallbackQ, plan);
  } catch {
    return null;
  }
}

/** 拼入 SQL Agent 输入：与 [查询计划] 并列的约束段。 */
export function formatSqlPreflightForSqlAgent(p?: SqlPreflightResult | null): string {
  if (!p) return "";
  const refined = (p.refined_question || "").trim();
  const summary = (p.sql_intent_summary || "").trim();
  const filters = (p.must_filters || []).filter(Boolean);
  const risks = (p.risk_notes || []).filter(Boolean);
  if (!refined && !summary && !filters.length && !risks.length) return "";

  const lines: string[] = [];
  lines.push("[SQL 编排要点]（仅用于生成 SQL 与选表；请勿向用户复述本段原文）");
  if (refined) lines.push(`- 独立问句：${refined}`);
  if (summary) lines.push(`- 意图摘要：${summary}`);
  if (filters.length) lines.push(`- 必须在 SQL 落实：${filters.join("；")}`);
  if (risks.length) lines.push(`- 风险提示：${risks.join("；")}`);
  return clipText(lines.join("\n"), 900);
}

export async function runSqlPreflight(
  model: BaseLanguageModel,
  params: { question: string; query_plan_json: string },
): Promise<SqlPreflightResult> {
  const q = String(params.question ?? "").trim();
  const planJson = String(params.query_plan_json ?? "").trim() || "{}";
  const plan = parseQueryPlan(planJson);
  const chain = RunnableSequence.from([preflightPrompt, model, new StringOutputParser()]).withConfig({
    runName: "SqlPreflightChain",
  });
  const env = getDbAgentBlueprintEnv();
  const raw = await chain.invoke({
    question: clipText(q, Math.min(800, env.maxModelInputChars)),
    query_plan_json: clipText(planJson, env.agentPlanMaxChars),
  });
  incrementLlmCallCount(1);
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return mergePlanNamesIntoPreflight(fallbackPreflight(q), plan, q);
  try {
    const o = JSON.parse(text.slice(start, end + 1));
    return normalizeSqlPreflight(o, q, plan);
  } catch {
    return mergePlanNamesIntoPreflight(fallbackPreflight(q), plan, q);
  }
}
