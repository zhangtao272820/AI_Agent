/**
 * DB Stage-3 意图 Playbook RAG：lexical 预召回，对齐 Admin/RAG。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { DbQueryIntent } from "./dbQueryIntentLlm";
import { DB_INTENT_PLAYBOOK } from "./dbIntentPlaybook";
import { recallSimilarExperienceAsync } from "../query_learning";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";

export type DbIntentRecallHit = {
  id: string;
  score: number;
  intent: DbQueryIntent;
  matched_text: string;
  slot_hints: string[];
  source: "playbook" | "experience";
};

function tokenBag(text: string): Set<string> {
  const norm = String(text || "").toLowerCase();
  const parts = norm.match(/[\u4e00-\u9fff]+|[a-z]+|\d+/g) || [];
  return new Set(parts.slice(0, 160));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

export function isDbIntentRagEnabled(): boolean {
  return isDbNluFeatureEnabled("intent_rag");
}

export function recallDbIntentPlaybook(query: string): DbIntentRecallHit | null {
  const q = String(query || "").trim();
  if (!q || q.length < 4 || !isDbIntentRagEnabled()) return null;
  const bag = tokenBag(q);
  let best: DbIntentRecallHit | null = null;
  for (const entry of DB_INTENT_PLAYBOOK) {
    for (const p of entry.paraphrases) {
      const score = jaccard(bag, tokenBag(p));
      if (!best || score > best.score) {
        best = {
          id: entry.id,
          score,
          intent: entry.intent,
          matched_text: p,
          slot_hints: entry.slot_hints,
          source: "playbook",
        };
      }
    }
  }
  return best && best.score >= 0.2 ? best : null;
}

export async function recallDbIntentWithExperience(
  question: string,
  embeddingConfig?: { openaiApiKey?: string; model?: string; baseUrl?: string } | null,
): Promise<DbIntentRecallHit | null> {
  const playbook = recallDbIntentPlaybook(question);
  if (!isDbIntentRagEnabled()) return playbook;

  const exps = await recallSimilarExperienceAsync(question, 2, embeddingConfig ?? undefined).catch(() => []);
  if (!exps.length) return playbook;

  const top = exps[0]!;
  const expHit: DbIntentRecallHit = {
    id: `exp:${top.question_norm?.slice(0, 24) || "x"}`,
    score: 0.55,
    intent: (top.path === "sql_direct" ? "attribute_lookup" : "detail_list") as DbQueryIntent,
    matched_text: String(top.hint || top.question_norm || "").slice(0, 120),
    slot_hints: [],
    source: "experience",
  };

  if (!playbook || expHit.score > playbook.score) return expHit;
  return playbook;
}

/** 将 Playbook 召回合并进 intent 解析（仅当 LLM 低置信时提升） */
export function mergeDbIntentRecall(
  resolved: { intent: DbQueryIntent; source: string; reason: string },
  recall: DbIntentRecallHit | null,
): { intent: DbQueryIntent; source: string; reason: string } {
  if (!recall) return resolved;
  if (resolved.source === "llm" && resolved.intent !== "unknown") return resolved;
  return {
    intent: recall.intent,
    source: recall.source === "playbook" ? "playbook_rag" : "experience_rag",
    reason: `intent_rag:${recall.id}`,
  };
}
