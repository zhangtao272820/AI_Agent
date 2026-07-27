/**
 * P6+ 向量经验库：embedding 语义召回（带输入截断 + 查询缓存，控制 token 成本）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OpenAIEmbeddings } from "@langchain/openai";
import { getEmbeddingModel, type EmbeddingClientConfig } from "./agent";
import { getDbAgentBlueprintEnv } from "./db_agent_env";
import type { DbExperienceEntry } from "./query_learning";
import { normalizeQuestionKey } from "./query_learning";
import { upsertDbExperienceVector, searchDbExperienceByVector, clearDbExperienceVectorsPg, PGVECTOR_DIM } from "#agent-shared/agentVectorPg";
import { isExperienceRecallConfirmedOnly } from "#agent-shared/experienceRecallPolicy";
import { readDbExperienceForRecall } from "./experience_store";
import { dbExperienceBlueprintEligible, resolveDbIntentRagBlueprintDomain } from "./nlu/dbIntentRagDomain";
import { findPromptHygieneViolations } from "#agent-shared/promptHygiene";

export type ExperienceVectorRow = {
  id: string;
  ts: string;
  question_norm: string;
  question: string;
  vector: number[];
  hint: string;
  path: string;
  data_domain?: string;
  blueprint_domain?: string;
  tables?: string[];
  sql?: string;
};

const INDEXABLE_PATHS = new Set(["sql_direct", "person_health", "statistics", "sql_agent", "person_info"]);

function vectorRowRecallEligible(row: ExperienceVectorRow): boolean {
  const active = resolveDbIntentRagBlueprintDomain();
  if (!dbExperienceBlueprintEligible(row.blueprint_domain, active)) return false;
  if (findPromptHygieneViolations(row.question_norm).length) return false;
  return true;
}

function dataDir() {
  const dir = join(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function vectorsFile() {
  return join(dataDir(), "db-experience-vectors.json");
}

function loadRows(): ExperienceVectorRow[] {
  const p = vectorsFile();
  if (!existsSync(p)) return [];
  try {
    const o = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(o) ? (o as ExperienceVectorRow[]) : [];
  } catch {
    return [];
  }
}

function saveRows(rows: ExperienceVectorRow[]) {
  const max = getDbAgentBlueprintEnv().vectorExperienceMaxEntries;
  writeFileSync(vectorsFile(), JSON.stringify(rows.slice(-max), null, 0), "utf8");
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/** 送入 embedding 的文本：去噪 + 截断，降低计费 token。 */
export function clipTextForEmbedding(text: string): string {
  const env = getDbAgentBlueprintEnv();
  const max = env.embeddingMaxInputChars;
  let s = String(text ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[【】\[\]()（）]/g, "")
    .replace(/(请|帮我|麻烦|查询|查一下|统计一下|看看)/g, "");
  if (s.length <= max) return s;
  return s.slice(0, max);
}

let embeddingsClient: OpenAIEmbeddings | null = null;
let embeddingsKey = "";

const queryEmbedCache = new Map<string, { vec: number[]; ts: number }>();

function getEmbeddings(config: EmbeddingClientConfig): OpenAIEmbeddings | null {
  const env = getDbAgentBlueprintEnv();
  if (!config.openaiApiKey || !env.enableVectorExperience) return null;
  const key = [
    config.openaiApiKey.slice(0, 8),
    config.openaiBaseUrl ?? "",
    config.embeddingModel ?? "text-embedding-v1",
    String(config.embeddingDimensions ?? PGVECTOR_DIM),
  ].join("|");
  if (embeddingsClient && embeddingsKey === key) return embeddingsClient;
  try {
    embeddingsClient = getEmbeddingModel(config);
    embeddingsKey = key;
    return embeddingsClient;
  } catch {
    return null;
  }
}

async function embedQueryCached(text: string, embedder: OpenAIEmbeddings): Promise<number[]> {
  const env = getDbAgentBlueprintEnv();
  const clipped = clipTextForEmbedding(text);
  const cacheKey = normalizeQuestionKey(clipped);
  const ttlMs = env.embeddingQueryCacheTtlSec * 1000;
  const hit = queryEmbedCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.vec;

  const vec = await embedder.embedQuery(clipped);
  queryEmbedCache.set(cacheKey, { vec, ts: Date.now() });
  if (queryEmbedCache.size > 180) {
    const oldest = [...queryEmbedCache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 40);
    for (const [k] of oldest) queryEmbedCache.delete(k);
  }
  return vec;
}

export async function indexExperienceVector(input: {
  question: string;
  hint: string;
  path: string;
  data_domain?: string;
  blueprint_domain?: string;
  tables?: string[];
  sql?: string;
  embeddingConfig: EmbeddingClientConfig;
}) {
  const env = getDbAgentBlueprintEnv();
  if (!env.enableVectorExperience) return;
  if (!INDEXABLE_PATHS.has(String(input.path || ""))) return;

  const question = String(input.question ?? "").trim();
  const hint = String(input.hint ?? "").trim();
  if (!question || !hint || question.length < env.vectorIndexMinQuestionChars) return;

  const embedder = getEmbeddings(input.embeddingConfig);
  if (!embedder) return;

  const question_norm = normalizeQuestionKey(question);
  const rows = loadRows();
  const dup = rows.find((r) => r.question_norm === question_norm);
  if (dup) {
    dup.hint = hint;
    dup.path = input.path;
    dup.ts = new Date().toISOString();
    dup.data_domain = input.data_domain;
    dup.blueprint_domain = input.blueprint_domain ?? getDbAgentBlueprintEnv().domain;
    dup.tables = input.tables;
    if (input.sql) dup.sql = input.sql;
    saveRows(rows);
    void upsertDbExperienceVector({
      experienceKey: dup.id,
      questionNorm: question_norm,
      hint,
      path: input.path,
      dataDomain: input.data_domain,
      embedding: dup.vector,
      metadata: { tables: input.tables, sql: input.sql },
    }).catch(() => undefined);
    return;
  }

  try {
    const clipped = clipTextForEmbedding(question);
    const vector = await embedder.embedQuery(clipped);
    rows.push({
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      question_norm,
      question: clipped.slice(0, 120),
      vector,
      hint,
      path: input.path,
      data_domain: input.data_domain,
      blueprint_domain: input.blueprint_domain ?? getDbAgentBlueprintEnv().domain,
      tables: input.tables,
      sql: input.sql,
    });
    saveRows(rows);
    void upsertDbExperienceVector({
      experienceKey: rows[rows.length - 1]!.id,
      questionNorm: question_norm,
      hint,
      path: input.path,
      dataDomain: input.data_domain,
      embedding: vector,
      metadata: { tables: input.tables, sql: input.sql },
    }).catch(() => undefined);
  } catch {
    /* embedding 失败不影响主链路 */
  }
}

export async function recallByVectorSimilarityWithScore(
  question: string,
  config: EmbeddingClientConfig,
  limit = 3,
): Promise<Array<{ row: ExperienceVectorRow; score: number }>> {
  const env = getDbAgentBlueprintEnv();
  if (!env.enableVectorExperience) return [];
  const embedder = getEmbeddings(config);
  if (!embedder) return [];

  const q = String(question ?? "").trim();
  if (!q || q.length < 4) return [];

  let rows = loadRows().filter((r) => r.sql && String(r.sql).trim() && vectorRowRecallEligible(r));
  if (isExperienceRecallConfirmedOnly()) {
    const confirmed = new Set(readDbExperienceForRecall(600).map((r) => r.question_norm));
    rows = rows.filter((r) => confirmed.has(r.question_norm));
  }
  if (!rows.length) return [];

  try {
    const queryVec = await embedQueryCached(q, embedder);
    return rows
      .map((r) => ({ row: r, score: cosineSimilarity(queryVec, r.vector) }))
      .filter((x) => x.score >= env.vectorExperienceMinScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function recallByVectorSimilarity(
  question: string,
  config: EmbeddingClientConfig,
  limit = 3,
): Promise<DbExperienceEntry[]> {
  const env = getDbAgentBlueprintEnv();
  if (!env.enableVectorExperience) return [];
  const embedder = getEmbeddings(config);
  if (!embedder) return [];

  const q = String(question ?? "").trim();
  if (!q || q.length < 4) return [];

  const rows = loadRows().filter(vectorRowRecallEligible);
  if (!rows.length) return [];

  try {
    const queryVec = await embedQueryCached(q, embedder);
    const minScore = env.vectorExperienceMinScore;
    const scored = rows
      .map((r) => ({ r, s: cosineSimilarity(queryVec, r.vector) }))
      .filter((x) => x.s >= minScore)
      .sort((a, b) => b.s - a.s);

    const seen = new Set<string>();
    const out: DbExperienceEntry[] = [];
    for (const { r } of scored) {
      const k = `${r.path}|${r.hint}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        ts: r.ts,
        question_norm: r.question_norm,
        path: r.path as DbExperienceEntry["path"],
        data_domain: r.data_domain,
        tables: r.tables,
        hint: r.hint,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function getExperienceVectorSummary() {
  const env = getDbAgentBlueprintEnv();
  const rows = loadRows();
  return {
    count: rows.length,
    enabled: env.enableVectorExperience,
    embeddingMaxInputChars: env.embeddingMaxInputChars,
    recallOnlyWhenNgramWeak: env.vectorRecallOnlyWhenNgramWeak,
    queryCacheTtlSec: env.embeddingQueryCacheTtlSec,
  };
}

export function clearExperienceVectors() {
  try {
    writeFileSync(vectorsFile(), "[]", "utf8");
  } catch {
    /* ignore */
  }
  queryEmbedCache.clear();
  embeddingsClient = null;
  embeddingsKey = "";
  void clearDbExperienceVectorsPg().catch(() => undefined);
}
