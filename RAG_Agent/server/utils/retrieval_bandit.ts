/**
 * P7/P8 多臂 Bandit：检索重排路径在线探索（Thompson 采样 + 延迟/质量联合奖励）。
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getRagAgentEnv } from "./rag_agent_env";
import { readRecentRagMetrics } from "./query_metrics";

export type RetrievalBanditArm =
  | "embedding_rerank"
  | "onnx_rerank"
  | "dedicated_rerank"
  | "cross_encoder"
  | "local_rerank"
  | "llm_rerank";

const ARMS: RetrievalBanditArm[] = [
  "embedding_rerank",
  "onnx_rerank",
  "dedicated_rerank",
  "cross_encoder",
  "local_rerank",
  "llm_rerank",
];

type BanditArmState = {
  arm: RetrievalBanditArm;
  alpha: number;
  beta: number;
  pulls: number;
  lastReward: number;
  avgLatencyMs: number;
  updatedAt: string;
};

type BanditStore = {
  updatedAt: string;
  arms: BanditArmState[];
};

function banditFile() {
  const dir = join(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "rag-retrieval-bandit.json");
}

function defaultArm(arm: RetrievalBanditArm): BanditArmState {
  return {
    arm,
    alpha: 1,
    beta: 1,
    pulls: 0,
    lastReward: 0.5,
    avgLatencyMs: 0,
    updatedAt: new Date().toISOString(),
  };
}

function loadStore(): BanditStore {
  const p = banditFile();
  if (!existsSync(p)) {
    return { updatedAt: new Date().toISOString(), arms: ARMS.map(defaultArm) };
  }
  try {
    const o = JSON.parse(readFileSync(p, "utf8")) as BanditStore;
    const byArm = new Map((o.arms || []).map((a) => [a.arm, a]));
    return {
      updatedAt: o.updatedAt || new Date().toISOString(),
      arms: ARMS.map((arm) => {
        const row = byArm.get(arm);
        return row
          ? { ...defaultArm(arm), ...row, arm }
          : defaultArm(arm);
      }),
    };
  } catch {
    return { updatedAt: new Date().toISOString(), arms: ARMS.map(defaultArm) };
  }
}

function saveStore(store: BanditStore) {
  store.updatedAt = new Date().toISOString();
  writeFileSync(banditFile(), JSON.stringify(store, null, 2), "utf8");
}

function sampleBeta(alpha: number, beta: number): number {
  const a = Math.max(0.5, alpha);
  const b = Math.max(0.5, beta);
  const u1 = randomBytes(4).readUInt32BE(0) / 0xffffffff;
  const u2 = randomBytes(4).readUInt32BE(0) / 0xffffffff;
  const x = Math.pow(u1, 1 / a);
  const y = Math.pow(u2, 1 / b);
  const d = x + y;
  return d > 0 ? x / d : 0.5;
}

/** P8：质量 ok + 延迟越快奖励越高（0~1） */
export function computeBanditReward(ok: boolean, ms?: number, targetMs = 2500): number {
  if (!ok) return 0;
  const latency = Math.max(0, Number(ms ?? 0));
  const speed = targetMs > 0 ? Math.max(0, Math.min(1, 1 - latency / targetMs)) : 0.5;
  return 0.65 + speed * 0.35;
}

export type BanditRerankPlan = {
  arm: RetrievalBanditArm;
  preferOnnx: boolean;
  preferEmbedding: boolean;
  preferDedicated: boolean;
  preferCrossEncoder: boolean;
  preferLocal: boolean;
  forceLlmRerank: boolean;
};

export function localRerankBanditPlan(): BanditRerankPlan {
  return armToPlan("local_rerank");
}

function armToPlan(arm: RetrievalBanditArm): BanditRerankPlan {
  switch (arm) {
    case "embedding_rerank":
      return {
        arm,
        preferOnnx: false,
        preferEmbedding: true,
        preferDedicated: false,
        preferCrossEncoder: false,
        preferLocal: false,
        forceLlmRerank: false,
      };
    case "onnx_rerank":
      return {
        arm,
        preferOnnx: true,
        preferEmbedding: false,
        preferDedicated: false,
        preferCrossEncoder: false,
        preferLocal: false,
        forceLlmRerank: false,
      };
    case "dedicated_rerank":
      return {
        arm,
        preferOnnx: false,
        preferEmbedding: false,
        preferDedicated: true,
        preferCrossEncoder: false,
        preferLocal: false,
        forceLlmRerank: false,
      };
    case "cross_encoder":
      return {
        arm,
        preferOnnx: false,
        preferEmbedding: false,
        preferDedicated: false,
        preferCrossEncoder: true,
        preferLocal: false,
        forceLlmRerank: false,
      };
    case "local_rerank":
      return {
        arm,
        preferOnnx: false,
        preferEmbedding: false,
        preferDedicated: false,
        preferCrossEncoder: false,
        preferLocal: true,
        forceLlmRerank: false,
      };
    case "llm_rerank":
      return {
        arm,
        preferOnnx: false,
        preferEmbedding: false,
        preferDedicated: false,
        preferCrossEncoder: false,
        preferLocal: false,
        forceLlmRerank: true,
      };
  }
}

export function sampleRetrievalBanditArm(contextKey: string, sessionSeed?: string): BanditRerankPlan {
  const env = getRagAgentEnv();
  if (!env.enableRetrievalBandit) {
    return armToPlan(env.enableEmbeddingRerank ? "embedding_rerank" : "cross_encoder");
  }

  const store = loadStore();
  const explorePct = env.retrievalBanditExplorePercent;
  if (explorePct > 0 && sessionSeed) {
    const h = createHash("sha256").update(`rag-bandit|${sessionSeed}|${contextKey}`).digest();
    if (h.readUInt32BE(0) % 100 < explorePct) {
      const idx = h.readUInt32BE(4) % ARMS.length;
      return armToPlan(ARMS[idx]!);
    }
  }

  let best: RetrievalBanditArm = env.enableEmbeddingRerank ? "embedding_rerank" : "cross_encoder";
  let bestScore = -1;
  for (const a of store.arms) {
    const s = sampleBeta(a.alpha, a.beta);
    if (s > bestScore) {
      bestScore = s;
      best = a.arm;
    }
  }
  return armToPlan(best);
}

export function recordRetrievalBanditOutcome(
  arm: RetrievalBanditArm,
  ok: boolean,
  opts?: { ms?: number; targetMs?: number }
) {
  const env = getRagAgentEnv();
  if (!env.enableRetrievalBandit) return;

  const reward = computeBanditReward(ok, opts?.ms, opts?.targetMs ?? env.banditTargetLatencyMs);
  const store = loadStore();
  const row = store.arms.find((a) => a.arm === arm);
  if (!row) return;

  row.pulls += 1;
  row.lastReward = reward;
  if (opts?.ms != null) {
    row.avgLatencyMs =
      row.pulls <= 1 ? opts.ms : Math.round(row.avgLatencyMs * 0.85 + opts.ms * 0.15);
  }
  if (reward >= 0.55) {
    row.alpha += reward;
  } else {
    row.beta += 1 - reward;
  }
  row.updatedAt = new Date().toISOString();
  saveStore(store);
}

export function refreshRetrievalBanditFromMetrics(limit = 400) {
  const env = getRagAgentEnv();
  if (!env.enableRetrievalBandit) return;

  const rows = readRecentRagMetrics(limit).filter((r) => r.path === "document_query");
  for (const r of rows) {
    const mode = String(r.rerank_mode || "");
    let arm: RetrievalBanditArm | null = null;
    if (mode === "embedding_rerank") arm = "embedding_rerank";
    else if (mode === "onnx_rerank") arm = "onnx_rerank";
    else if (mode === "dedicated_rerank") arm = "dedicated_rerank";
    else if (mode === "cross_encoder") arm = "cross_encoder";
    else if (mode === "local_rerank") arm = "local_rerank";
    else if (mode && mode !== "lexical" && mode !== "none") arm = "llm_rerank";
    if (arm) recordRetrievalBanditOutcome(arm, Boolean(r.ok), { ms: r.ms });
  }
}

export function getRetrievalBanditSummary() {
  const env = getRagAgentEnv();
  const store = loadStore();
  const scores: Record<string, number> = {};
  for (const a of store.arms) {
    const trials = a.alpha + a.beta - 2;
    scores[a.arm] = trials > 0 ? a.alpha / (a.alpha + a.beta) : 0.5;
  }
  return {
    enabled: env.enableRetrievalBandit,
    explorePercent: env.retrievalBanditExplorePercent,
    multiObjective: env.enableBanditMultiObjective,
    targetLatencyMs: env.banditTargetLatencyMs,
    updatedAt: store.updatedAt,
    arms: store.arms.map((a) => ({
      arm: a.arm,
      pulls: a.pulls,
      alpha: a.alpha,
      beta: a.beta,
      estimatedOkRate: scores[a.arm],
      avgLatencyMs: a.avgLatencyMs,
      lastReward: a.lastReward,
    })),
  };
}

export function clearRetrievalBandit() {
  const p = banditFile();
  if (existsSync(p)) {
    writeFileSync(p, JSON.stringify({ updatedAt: new Date().toISOString(), arms: ARMS.map(defaultArm) }, null, 2));
  }
}
