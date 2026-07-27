/**
 * P2-3：向量经验库中沉淀的成功 SQL，高相似度问句直出（跳过 LLM）。
 */
import type { DataSource } from "typeorm";
import type { EmbeddingClientConfig } from "./agent";
import { getDbAgentBlueprintEnv } from "./db_agent_env";
import { recallByVectorSimilarityWithScore } from "./experience_vectors";
import { experienceSqlDirectAlignsWithQuestion } from "./experience_sql_direct_guard";
import { recordQueryMetric } from "./query_metrics";
import {
  enforceSelectLimit,
  injectMysqlMaxExecutionTimeHint,
  isReadOnlySelectSql,
} from "./sql_safety";

export { experienceSqlDirectAlignsWithQuestion } from "./experience_sql_direct_guard";

export async function tryExperienceSqlDirect(
  ds: DataSource,
  question: string,
  embeddingConfig?: EmbeddingClientConfig | null,
): Promise<{ sql: string; rows: any[]; score: number; experienceId: string } | null> {
  const env = getDbAgentBlueprintEnv();
  if (!env.enableExperienceSqlDirect || !embeddingConfig) return null;

  const q = String(question ?? "").trim();
  if (!q) return null;

  const hits = await recallByVectorSimilarityWithScore(q, embeddingConfig, 1);
  const top = hits[0];
  if (!top || top.score < env.experienceSqlDirectMinScore || !top.row.sql) return null;

  const storedQ = String(top.row.question || "").trim();
  if (storedQ && !experienceSqlDirectAlignsWithQuestion(storedQ, q)) return null;

  const checked = isReadOnlySelectSql(top.row.sql);
  if (!checked.ok) return null;
  const limited = enforceSelectLimit(checked.sql, 100, 20);
  const withHint = injectMysqlMaxExecutionTimeHint(limited, 8000);

  try {
    const rows = (await ds.query(withHint)) as any[];
    if (!Array.isArray(rows) || !rows.length) return null;
    recordQueryMetric({ path: "sql_direct", ok: true, empty: false, reason: "experience_sql_direct" });
    return { sql: withHint, rows, score: top.score, experienceId: top.row.id };
  } catch {
    return null;
  }
}
