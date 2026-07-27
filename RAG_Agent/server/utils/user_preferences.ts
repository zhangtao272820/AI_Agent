/**
 * P4 跨会话用户画像：按 userKey（x-user-id / conversationId）沉淀检索偏好。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getRagAgentEnv } from "./rag_agent_env";
import { sanitizeUserId, resolveSharedUserId } from "./agent_identity";
import { formatCrossAgentProfileBlock } from "./cross_agent_profile";
import { filterTopicsRelevantToQuery, filterTextsRelevantToQuery } from "./preference_context_gate";
import { isOrchestratedByManager } from "./retrieval_context";

export type RagUserPreferences = {
  updated_at: string;
  query_count: number;
  frequent_topics?: string[];
  preferred_sources?: string[];
  last_intent?: string;
};

const GLOBAL_KEY = "__global__";

function prefsFile() {
  const dir = join(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "rag-user-preferences.json");
}

function loadAll(): Record<string, RagUserPreferences> {
  const p = prefsFile();
  if (!existsSync(p)) return {};
  try {
    const o = JSON.parse(readFileSync(p, "utf8"));
    return o && typeof o === "object" ? (o as Record<string, RagUserPreferences>) : {};
  } catch {
    return {};
  }
}

function saveAll(store: Record<string, RagUserPreferences>) {
  writeFileSync(prefsFile(), JSON.stringify(store, null, 2), "utf8");
}

export function normalizeUserKey(key?: string): string {
  const uid = sanitizeUserId(key);
  if (uid) return uid;
  const k = String(key ?? "").trim().slice(0, 64);
  if (k.startsWith("c:") && k.length > 2) return k;
  return k || GLOBAL_KEY;
}

export function resolveUserKeyFromRequest(parts: {
  userId?: string;
  conversationId?: string;
  headerUserId?: string;
  sessionId?: string;
}): string | undefined {
  const env = getRagAgentEnv();
  if (!env.enableUserPreferences) return undefined;
  const uid =
    sanitizeUserId(parts.headerUserId ?? parts.userId) ||
    resolveSharedUserId(parts.sessionId ?? parts.conversationId);
  if (uid) return uid;
  const cid = String(parts.conversationId ?? "").trim();
  if (cid && env.userPrefsFromConversationId) return normalizeUserKey(`c:${cid}`);
  return undefined;
}

export function getUserPreferences(userKey?: string): RagUserPreferences {
  if (!userKey) return { updated_at: "", query_count: 0 };
  return loadAll()[normalizeUserKey(userKey)] ?? { updated_at: "", query_count: 0 };
}

export function learnFromSuccessfulRetrieval(input: {
  userKey?: string;
  question: string;
  intent?: string;
  sources?: string[];
  topics?: string[];
}) {
  const env = getRagAgentEnv();
  if (!env.enableUserPreferences || !input.userKey) return;
  const key = normalizeUserKey(input.userKey);
  const store = loadAll();
  const prev = store[key] ?? { updated_at: "", query_count: 0 };

  const frequent_topics = Array.from(
    new Set([...(prev.frequent_topics ?? []), ...(input.topics ?? [])])
  ).slice(-env.userPrefsMaxTopics);

  const preferred_sources = Array.from(
    new Set([...(input.sources ?? []), ...(prev.preferred_sources ?? [])])
  ).slice(-8);

  store[key] = {
    updated_at: new Date().toISOString(),
    query_count: (prev.query_count ?? 0) + 1,
    frequent_topics: frequent_topics.length ? frequent_topics : prev.frequent_topics,
    preferred_sources: preferred_sources.length ? preferred_sources : prev.preferred_sources,
    last_intent: input.intent || prev.last_intent,
  };
  saveAll(store);
}

export async function formatUserPreferencesBlock(userKey?: string, currentQuery?: string): Promise<string> {
  if (!userKey || isOrchestratedByManager()) return "";
  const q = String(currentQuery || "").trim();
  const cross = await formatCrossAgentProfileBlock(userKey, currentQuery);
  const p = getUserPreferences(userKey);
  const lines: string[] = [];
  const topics = q
    ? await filterTopicsRelevantToQuery(q, p.frequent_topics)
    : (p.frequent_topics ?? []).slice(0, 5);
  if (topics.length) lines.push(`- 常查主题：${topics.slice(0, 5).join("、")}`);
  if (p.preferred_sources?.length) {
    const sources = q
      ? await filterTextsRelevantToQuery(q, p.preferred_sources)
      : p.preferred_sources.slice(0, 4);
    if (sources.length) lines.push(`- 常看文档：${sources.slice(0, 4).join("、")}`);
  }
  if (p.last_intent) {
    const intents = q ? await filterTextsRelevantToQuery(q, [p.last_intent]) : [p.last_intent];
    if (intents.length) lines.push(`- 近期问法类型：${p.last_intent}`);
  }
  const ragBlock = lines.length
    ? `[用户偏好]（历史口径参考，本句有明确条件时以本句为准）\n${lines.join("\n")}`
    : "";
  return [cross, ragBlock].filter(Boolean).join("\n\n");
}

export function getUserPreferencesSummary() {
  const store = loadAll();
  const keys = Object.keys(store);
  return { userCount: keys.length, global: store[GLOBAL_KEY] ?? null };
}

export function clearUserPreferences() {
  try {
    writeFileSync(prefsFile(), "{}", "utf8");
  } catch {
    /* ignore */
  }
}
