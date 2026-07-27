/**
 * P6 分层记忆（轻量）：跨请求沉淀用户常用口径，注入 Plan/SQL 阶段。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clipText } from "./nlu/text";
import type { QueryPlan } from "./nlu/query_plan";
import { getDbAgentBlueprintEnv } from "./db_agent_env";
import {
  isDbUserPreferencesPgEnabled,
  normalizeDbUserKey,
  readDbUserPreferencesPg,
  resolveDbStorageBackend,
  shouldWriteFile,
  shouldWritePostgres,
  upsertDbUserPreferencesPg,
  listDbUserPreferenceKeys,
} from "#agent-shared/dbUserPreferencesStore";

export type DbUserPreferences = {
  updated_at: string;
  default_time_relative?: string;
  preferred_data_domain?: QueryPlan["data_domain"];
  frequent_names?: string[];
  frequent_metrics?: string[];
  query_count?: number;
};

const GLOBAL_KEY = "__global__";

function prefsFile() {
  const dir = join(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "db-user-preferences.json");
}

function loadAll(): Record<string, DbUserPreferences> {
  const p = prefsFile();
  if (!existsSync(p)) return {};
  try {
    const o = JSON.parse(readFileSync(p, "utf8")) as Record<string, DbUserPreferences>;
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function saveAll(store: Record<string, DbUserPreferences>) {
  writeFileSync(prefsFile(), JSON.stringify(store, null, 2), "utf8");
}

function normalizeSessionKey(key?: string) {
  return normalizeDbUserKey(key);
}

export function getUserPreferences(sessionKey?: string): DbUserPreferences {
  const store = loadAll();
  return store[normalizeSessionKey(sessionKey)] ?? { updated_at: "", query_count: 0 };
}

export async function getUserPreferencesAsync(sessionKey?: string): Promise<DbUserPreferences> {
  const key = normalizeSessionKey(sessionKey);
  if (isDbUserPreferencesPgEnabled()) {
    const pg = await readDbUserPreferencesPg(key);
    if (pg) return { updated_at: pg.updated_at || "", query_count: pg.query_count ?? 0, ...pg };
  }
  return getUserPreferences(sessionKey);
}

export function learnFromSuccessfulQuery(input: {
  sessionKey?: string;
  question: string;
  plan: QueryPlan;
}) {
  const key = normalizeSessionKey(input.sessionKey);
  const store = loadAll();
  const prev = store[key] ?? { updated_at: "", query_count: 0 };
  const rel = String(input.plan.filters?.time_range?.relative ?? "").trim();
  const names = input.plan.entities.names.slice(0, 5);
  const metrics = input.plan.metrics.slice(0, 5);

  const frequent_names = Array.from(new Set([...(prev.frequent_names ?? []), ...names])).slice(-8);
  const frequent_metrics = Array.from(new Set([...(prev.frequent_metrics ?? []), ...metrics])).slice(-8);

  store[key] = {
    updated_at: new Date().toISOString(),
    query_count: (prev.query_count ?? 0) + 1,
    default_time_relative: rel || prev.default_time_relative,
    preferred_data_domain:
      input.plan.data_domain !== "general" ? input.plan.data_domain : prev.preferred_data_domain,
    frequent_names: frequent_names.length ? frequent_names : prev.frequent_names,
    frequent_metrics: frequent_metrics.length ? frequent_metrics : prev.frequent_metrics,
  };
  if (shouldWritePostgres(resolveDbStorageBackend())) {
    void upsertDbUserPreferencesPg(key, store[key]);
  }
  if (shouldWriteFile(resolveDbStorageBackend())) {
    saveAll(store);
  }
}

export function formatUserPreferencesBlock(sessionKey?: string): string {
  const p = getUserPreferences(sessionKey);
  const lines: string[] = [];
  if (p.default_time_relative) lines.push(`- 常用时间范围：${p.default_time_relative}`);
  if (p.preferred_data_domain && p.preferred_data_domain !== "general") {
    const domainZh =
      p.preferred_data_domain === "person_health"
        ? "个人健康体征"
        : p.preferred_data_domain === "person_basic"
          ? "人员基础档案"
          : p.preferred_data_domain;
    lines.push(`- 常查数据域：${domainZh}`);
  }
  if (p.frequent_names?.length) lines.push(`- 常查对象：${p.frequent_names.slice(0, 4).join("、")}`);
  if (p.frequent_metrics?.length) lines.push(`- 常关注指标：${p.frequent_metrics.slice(0, 4).join("、")}`);
  if (!lines.length) return "";
  const max = getDbAgentBlueprintEnv().experienceBlockMaxChars;
  return clipText(`[用户偏好]（历史口径参考，本句有明确条件时以本句为准）\n${lines.join("\n")}`, max);
}

export async function getUserPreferencesSummaryAsync() {
  const store = loadAll();
  const keys = Object.keys(store);
  const pgEnabled = isDbUserPreferencesPgEnabled();
  const pgKeys = pgEnabled ? await listDbUserPreferenceKeys() : [];
  return {
    sessionCount: Math.max(keys.length, pgKeys.length),
    global: store[GLOBAL_KEY] ?? null,
    pgEnabled,
    pgKeys,
  };
}

export function getUserPreferencesSummary() {
  const store = loadAll();
  const keys = Object.keys(store);
  return { sessionCount: keys.length, global: store[GLOBAL_KEY] ?? null, pgEnabled: isDbUserPreferencesPgEnabled() };
}

export function clearUserPreferences() {
  try {
    writeFileSync(prefsFile(), "{}", "utf8");
  } catch {
    /* ignore */
  }
}
