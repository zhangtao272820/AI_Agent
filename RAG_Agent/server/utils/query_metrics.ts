/**
 * RAG 检索与回答路径观测（进程内计数 + .data 落盘）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

export type RagQueryPath =
  | "document_query"
  | "document_list"
  | "document_upload"
  | "direct_answer"
  | "clarify";

export type RagQueryMetricEvent = {
  path: RagQueryPath;
  ok: boolean;
  weak_evidence?: boolean;
  ms?: number;
  question?: string;
  intent?: string;
  sub_query_count?: number;
  routing_mode?: string;
  reason?: string;
  agentic_rounds?: number;
  rerank_mode?: string;
  ab_variant?: string;
  bandit_arm?: string;
};

const counters: Record<string, number> = {};

function metricsFile() {
  const dir = join(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "rag-query-metrics.jsonl");
}

export function recordRagQueryMetric(ev: RagQueryMetricEvent) {
  const key = `${ev.path}:${ev.ok ? "ok" : "fail"}${ev.weak_evidence ? ":weak" : ""}`;
  counters[key] = (counters[key] || 0) + 1;
  try {
    const line = JSON.stringify({ ...ev, at: new Date().toISOString() });
    appendFileSync(metricsFile(), `${line}\n`, "utf8");
  } catch {
    /* 观测失败不影响主链路 */
  }
}

export function getRagQueryMetricCounters() {
  return { ...counters };
}

export function readRecentRagMetrics(limit = 50): RagQueryMetricEvent[] {
  try {
    const file = metricsFile();
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as RagQueryMetricEvent;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as RagQueryMetricEvent[];
  } catch {
    return [];
  }
}
