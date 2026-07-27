/**
 * P5 跨 Agent 画像：优先 internal user-context API，fallback 本地文件。
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getRagAgentEnv } from "./rag_agent_env";
import { normalizeUserKey } from "./user_preferences";
import { filterTextsRelevantToQuery } from "./preference_context_gate";
import { isOrchestratedByManager } from "./retrieval_context";

type DbUserPreferences = {
  updated_at?: string;
  query_count?: number;
  default_time_relative?: string;
  preferred_data_domain?: string;
  frequent_names?: string[];
  frequent_metrics?: string[];
};

function internalHeaders(): Record<string, string> {
  const token = String(process.env.CLAWHIVE_INTERNAL_TOKEN || process.env.AGENT_INTERNAL_TOKEN || "").trim();
  return token ? { "x-clawhive-internal-token": token } : {};
}

function dbUserContextUrl(): string {
  const custom = String(process.env.DB_AGENT_USER_CONTEXT_URL || "").trim();
  if (custom) return custom;
  const http = String(process.env.DB_AGENT_HTTP_URL || "http://localhost:13101").trim();
  return `${http.replace(/\/$/, "")}/api/internal/user-context`;
}

async function fetchDbPrefsFromApi(userKey: string): Promise<DbUserPreferences | null> {
  try {
    const url = `${dbUserContextUrl()}?user_key=${encodeURIComponent(userKey)}`;
    const res = await fetch(url, { headers: { accept: "application/json", ...internalHeaders() }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { preferences?: DbUserPreferences };
    return body?.preferences ?? null;
  } catch {
    return null;
  }
}

function dbPrefsPath(): string | null {
  const custom = String(process.env.AGENT_SHARED_DATA_DIR ?? "").trim();
  if (custom) return join(custom, "db-user-preferences.json");
  const sibling = join(process.cwd(), "..", "DB_Agent", ".data", "db-user-preferences.json");
  if (existsSync(sibling)) return sibling;
  const envPath = String(process.env.RAG_DB_PREFS_PATH ?? "").trim();
  if (envPath && existsSync(envPath)) return envPath;
  return null;
}

function loadDbPrefsStore(): Record<string, DbUserPreferences> {
  const p = dbPrefsPath();
  if (!p) return {};
  try {
    const o = JSON.parse(readFileSync(p, "utf8"));
    return o && typeof o === "object" ? (o as Record<string, DbUserPreferences>) : {};
  } catch {
    return {};
  }
}

export async function getDbUserPreferencesForKeyAsync(userKey?: string): Promise<DbUserPreferences | null> {
  if (!userKey) return null;
  const key = normalizeUserKey(userKey);
  const fromApi = await fetchDbPrefsFromApi(key);
  if (fromApi) return fromApi;
  return getDbUserPreferencesForKey(userKey);
}

export function getDbUserPreferencesForKey(userKey?: string): DbUserPreferences | null {
  if (!userKey) return null;
  const store = loadDbPrefsStore();
  const key = normalizeUserKey(userKey);
  if (key === "__global__") return store.__global__ ?? null;
  return store[key] ?? store[`c:${key}`] ?? null;
}

export async function formatCrossAgentProfileBlock(userKey?: string, currentQuery?: string): Promise<string> {
  const env = getRagAgentEnv();
  if (!env.enableCrossAgentProfile || !userKey || isOrchestratedByManager()) return "";
  const db = await getDbUserPreferencesForKeyAsync(userKey);
  if (!db) return "";
  const q = String(currentQuery || "").trim();

  type Candidate = { judgeText: string; line: string };
  const candidates: Candidate[] = [];

  if (db.preferred_data_domain && db.preferred_data_domain !== "general") {
    const domain = String(db.preferred_data_domain);
    candidates.push({
      judgeText: `数据域偏好：${domain}`,
      line: `- DB 常查数据域：${domain}`,
    });
  }
  for (const n of db.frequent_names ?? []) {
    const name = String(n || "").trim();
    if (!name) continue;
    candidates.push({ judgeText: `常查对象：${name}`, line: `- DB 常查对象：${name}` });
  }
  for (const m of db.frequent_metrics ?? []) {
    const metric = String(m || "").trim();
    if (!metric) continue;
    candidates.push({ judgeText: `常关注指标：${metric}`, line: `- DB 常关注指标：${metric}` });
  }
  if (db.default_time_relative) {
    const rel = String(db.default_time_relative);
    candidates.push({
      judgeText: `常用时间范围：${rel}`,
      line: `- DB 常用时间范围：${rel}`,
    });
  }

  if (!candidates.length) return "";

  let kept: Candidate[] = candidates;
  if (q) {
    const flags = await filterTextsRelevantToQuery(q, candidates.map((c) => c.judgeText));
    const flagSet = new Set(flags);
    kept = candidates.filter((c) => flagSet.has(c.judgeText));
  }

  const namePrefix = "- DB 常查对象：";
  const metricPrefix = "- DB 常关注指标：";
  const nameLines = kept.filter((c) => c.line.startsWith(namePrefix));
  const metricLines = kept.filter((c) => c.line.startsWith(metricPrefix));
  const otherLines = kept.filter(
    (c) => !c.line.startsWith(namePrefix) && !c.line.startsWith(metricPrefix)
  );

  const lines: string[] = [...otherLines.map((c) => c.line)];
  if (nameLines.length) {
    const names = nameLines.map((c) => c.line.slice(namePrefix.length));
    lines.push(`${namePrefix}${names.slice(0, 4).join("、")}`);
  }
  if (metricLines.length) {
    const metrics = metricLines.map((c) => c.line.slice(metricPrefix.length));
    lines.push(`${metricPrefix}${metrics.slice(0, 4).join("、")}`);
  }

  if (!lines.length) return "";
  return `[跨 Agent 画像]\n${lines.join("\n")}`;
}

export function getCrossAgentProfileSummary() {
  const store = loadDbPrefsStore();
  return {
    enabled: getRagAgentEnv().enableCrossAgentProfile,
    dbUserContextUrl: dbUserContextUrl(),
    linkedUsers: Object.keys(store).length,
  };
}
