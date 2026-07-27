import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { QueryPath } from "../query_metrics";
import type { DbLearningSignal } from "../query_learning";
import { normalizeQuestionKey } from "../query_learning";
import {
  clearDbRouteStats,
  readDbRouteStatsSync,
  replaceDbRouteStats,
  shouldUseDbRoutePg,
  upsertDbRouteStat,
} from "#agent-shared/dbRouteStatsStore";
import type { RouteExecutionPath, RouteDecision, RoutePreferenceRow, RoutePreferencesFile } from "./types";

function dataDir() {
  const dir = join(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function prefsFile() {
  return join(dataDir(), "db-route-preferences.json");
}

export function readRoutePrefs(): RoutePreferencesFile {
  if (shouldUseDbRoutePg()) {
    const rows = readDbRouteStatsSync();
    return {
      updatedAt: new Date().toISOString(),
      rows: rows.map((r) => ({
        contextKey: r.contextKey,
        path: r.path as QueryPath,
        trials: r.trials,
        successes: r.successes,
        empty: r.empty,
        avgMs: r.avgMs,
      })),
    };
  }
  const file = prefsFile();
  if (!existsSync(file)) return { updatedAt: "", rows: [] };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as RoutePreferencesFile;
    return raw?.rows ? raw : { updatedAt: "", rows: [] };
  } catch {
    return { updatedAt: "", rows: [] };
  }
}

async function writePrefsRows(rows: RoutePreferenceRow[]) {
  if (shouldUseDbRoutePg()) {
    await replaceDbRouteStats(
      rows.map((r) => ({
        contextKey: r.contextKey,
        path: r.path,
        trials: r.trials,
        successes: r.successes,
        empty: r.empty,
        avgMs: r.avgMs,
      })),
    );
    return;
  }
  const file: RoutePreferencesFile = { updatedAt: new Date().toISOString(), rows };
  try {
    writeFileSync(prefsFile(), JSON.stringify(file, null, 2), "utf8");
  } catch {
    /* ignore */
  }
}

function planPrefix(contextKey: string): string {
  const parts = contextKey.split(":");
  return parts.slice(0, 2).join(":") + ":";
}

export function pathScoreFromPrefs(
  prefs: RoutePreferenceRow[],
  contextKey: string,
  path: QueryPath,
): number {
  const exact = prefs.find((r) => r.contextKey === contextKey && r.path === path);
  const prefix = planPrefix(contextKey);
  const family = prefs.filter((r) => r.contextKey.startsWith(prefix) && r.path === path);
  const rows = exact ? [exact, ...family] : family;
  if (!rows.length) return 0.5;
  let trials = 0;
  let successes = 0;
  let empty = 0;
  for (const r of rows) {
    trials += r.trials;
    successes += r.successes;
    empty += r.empty;
  }
  const okRate = (successes + 1) / (trials + 2);
  const emptyRate = trials ? empty / trials : 0;
  return okRate * (1 - emptyRate * 0.35);
}

function executionPathToMetricPath(p: RouteExecutionPath): QueryPath {
  if (p === "sql_preflight") return "sql_direct";
  if (p === "statistics") return "statistics";
  return p;
}

/** 从学习信号刷新路径偏好（Bandit 统计）。 */
export function refreshRoutePreferencesFromSignals(signals: DbLearningSignal[], maxSignals = 600) {
  const slice = signals.slice(-maxSignals);
  const map = new Map<string, RoutePreferenceRow>();

  for (const s of slice) {
    if (!s.path || s.path === "other") continue;
    const domain = String(s.data_domain || "general");
    const intent = String(s.intent || "unknown");
    const join = (s.tables ?? []).length > 1 ? "join" : "nojoin";
    const contextKey = `${domain}:${intent}:person:${join}`;
    const key = `${contextKey}|${s.path}`;
    const row = map.get(key) ?? {
      contextKey,
      path: s.path,
      trials: 0,
      successes: 0,
      empty: 0,
      avgMs: 0,
    };
    row.trials += 1;
    if (s.ok && !s.empty) row.successes += 1;
    if (s.empty) row.empty += 1;
    if (s.ms) row.avgMs = row.avgMs ? (row.avgMs + s.ms) / 2 : s.ms;
    map.set(key, row);
  }

  const file: RoutePreferencesFile = {
    updatedAt: new Date().toISOString(),
    rows: Array.from(map.values()),
  };
  void writePrefsRows(file.rows);
  return file;
}

export function getRoutePreferencesSummary() {
  const file = readRoutePrefs();
  const byPath: Record<string, { trials: number; successes: number; empty: number }> = {};
  for (const r of file.rows) {
    const k = r.path;
    if (!byPath[k]) byPath[k] = { trials: 0, successes: 0, empty: 0 };
    byPath[k].trials += r.trials;
    byPath[k].successes += r.successes;
    byPath[k].empty += r.empty;
  }
  return { updatedAt: file.updatedAt, rowCount: file.rows.length, byPath };
}

export function recordRouteDecisionOutcome(input: {
  question: string;
  decision: RouteDecision;
  ok: boolean;
  empty?: boolean;
  ms?: number;
}) {
  const key = input.decision.contextKey;
  const path = executionPathToMetricPath(input.decision.executionPath);
  const file = readRoutePrefs();
  const rowKey = `${key}|${path}`;
  let row = file.rows.find((r) => `${r.contextKey}|${r.path}` === rowKey);
  if (!row) {
    row = { contextKey: key, path, trials: 0, successes: 0, empty: 0, avgMs: 0 };
    file.rows.push(row);
  }
  row.trials += 1;
  if (input.ok && !input.empty) row.successes += 1;
  if (input.empty) row.empty += 1;
  if (input.ms) row.avgMs = row.avgMs ? (row.avgMs + input.ms) / 2 : input.ms;
  if (shouldUseDbRoutePg()) {
    void upsertDbRouteStat({
      contextKey: row.contextKey,
      path: row.path,
      trials: row.trials,
      successes: row.successes,
      empty: row.empty,
      avgMs: row.avgMs,
    });
  } else {
    file.updatedAt = new Date().toISOString();
    try {
      writeFileSync(prefsFile(), JSON.stringify(file, null, 2), "utf8");
    } catch {
      /* ignore */
    }
  }
  void normalizeQuestionKey(input.question);
}

export function clearRoutePreferences() {
  const file: RoutePreferencesFile = { updatedAt: new Date().toISOString(), rows: [] };
  if (shouldUseDbRoutePg()) {
    void clearDbRouteStats();
  } else {
    try {
      writeFileSync(prefsFile(), JSON.stringify(file, null, 2), "utf8");
    } catch {
      /* ignore */
    }
  }
  return file;
}
