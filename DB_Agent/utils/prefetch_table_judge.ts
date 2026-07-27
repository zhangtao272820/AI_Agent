/**
 * 预取 table_judge 权威性：仅 LLM 选表结果可整段复用，禁止切片伪造 primary。
 */
import type { SchemaTableJudgeResult } from "./schema_table_judge";

export type PrefetchJudgeSource = "llm";

const FAKE_PREFETCH_REASONINGS = new Set(["manager_prefetch_plan", "manager_prefetch_reuse"]);

export function isFakePrefetchTableJudge(
  judge: SchemaTableJudgeResult | null | undefined,
): boolean {
  if (!judge) return false;
  const src = String((judge as { judge_source?: string }).judge_source ?? "").trim();
  if (src === "llm") return false;
  const reasoning = String(judge.reasoning ?? "").trim();
  return FAKE_PREFETCH_REASONINGS.has(reasoning);
}

/** 预取 JSON 中的选表是否来自模型，可供 DB 跳过二次选表 */
export function isAuthoritativeLlmTableJudge(
  judge: SchemaTableJudgeResult | null | undefined,
): boolean {
  if (!judge) return false;
  if (!(judge.primary_tables?.length > 0)) return false;
  if (isFakePrefetchTableJudge(judge)) return false;
  const src = String((judge as { judge_source?: string }).judge_source ?? "").trim();
  return src === "llm";
}

export function stampLlmTableJudge(judge: SchemaTableJudgeResult): SchemaTableJudgeResult & {
  judge_source: PrefetchJudgeSource;
} {
  return { ...judge, judge_source: "llm" };
}

export function parseSchemaGroundTableJudge(raw: string | undefined | null): {
  candidate_tables: string[];
  table_judge?: SchemaTableJudgeResult & { judge_source?: string };
} | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const g = JSON.parse(s) as {
      candidate_tables?: string[];
      table_judge?: SchemaTableJudgeResult & { judge_source?: string };
    };
    return {
      candidate_tables: Array.isArray(g.candidate_tables) ? g.candidate_tables.filter(Boolean) : [],
      table_judge: g.table_judge,
    };
  } catch {
    return null;
  }
}
