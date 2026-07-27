/**
 * SQL 自修复：执行/校验失败后单次 LLM 修复（P6 / P0）。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { clipText } from "./nlu/text";
import { extractSqlFromLlmOutput } from "./sql_safety";
import type { QueryIr } from "./query_ir";
import { formatQueryIrForSqlPrompt } from "./query_ir";
import { sqlRepairSystemPrompt } from "./sql/prompts";

export async function repairSqlWithLlm(
  model: BaseLanguageModel,
  opts: {
    question: string;
    sql: string;
    error: string;
    queryIr?: QueryIr | null;
    schemaSummary?: string;
  },
): Promise<string | null> {
  const prompt = [
    sqlRepairSystemPrompt(),
    `用户问题：${clipText(opts.question, 300)}`,
    opts.queryIr ? `QueryIR：${formatQueryIrForSqlPrompt(opts.queryIr)}` : "",
    opts.schemaSummary ? `Schema：${clipText(opts.schemaSummary, 800)}` : "",
    `原 SQL：${clipText(opts.sql, 600)}`,
    `错误：${clipText(opts.error, 300)}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const resp = await model.invoke(prompt);
    const text =
      typeof (resp as any)?.content === "string" ? (resp as any).content : JSON.stringify((resp as any)?.content);
    const sql = extractSqlFromLlmOutput(text);
    return sql.trim() || null;
  } catch {
    return null;
  }
}

/** 是否属于应触发 Agent 的硬失败 */
export function isHardSqlDirectFailure(reason: string): boolean {
  const r = String(reason ?? "");
  if (r.startsWith("exec_error:")) return true;
  if (r.startsWith("sql_rejected:")) return true;
  if (r.startsWith("sql_semantic:")) return true;
  if (r.startsWith("sql_guard:")) return true;
  if (r.startsWith("llm_error:")) return true;
  return false;
}
