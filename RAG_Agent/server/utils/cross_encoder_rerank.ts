/**
 * Cross-Encoder 重排：P8 进程内 embedding → 可选 ONNX → 专用 HTTP → DashScope CE → 本地 TF-IDF → 词法。
 */
import { lexicalRerankCandidates } from "./lexical_rerank";
import { localRerankCandidates } from "./local_rerank";
import { dedicatedRerankCandidates } from "./dedicated_rerank";
import { embeddingRerankCandidates } from "./embedding_rerank";
import { onnxRerankCandidates } from "./onnx_rerank";
import type { BanditRerankPlan } from "./retrieval_bandit";
import { getRagAgentEnv } from "./rag_agent_env";

export type CrossEncoderRankedDoc<T> = { doc: T; score: number };

export type RerankMode =
  | "onnx_rerank"
  | "embedding_rerank"
  | "dedicated_rerank"
  | "cross_encoder"
  | "local_rerank"
  | "lexical"
  | "none";

function dashscopeRerankEndpoint(): string {
  const base = String(process.env.OPENAI_BASE_URL ?? "").trim();
  if (base.includes("dashscope.aliyuncs.com")) {
    return "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank";
  }
  const custom = String(process.env.RAG_CROSS_ENCODER_URL ?? "").trim();
  return custom;
}

export async function crossEncoderRerankCandidates<T extends { pageContent?: string }>(
  query: string,
  docs: T[],
  model: string,
  topN = 8
): Promise<CrossEncoderRankedDoc<T>[] | null> {
  if (!model || docs.length === 0) return null;
  const endpoint = dashscopeRerankEndpoint();
  if (!endpoint) return null;

  const documents = docs.map((d) => String(d.pageContent ?? "").slice(0, 1200));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: { query: String(query).slice(0, 500), documents },
        parameters: { top_n: Math.min(topN, documents.length), return_documents: false },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const results = Array.isArray(data?.output?.results) ? data.output.results : [];
    if (!results.length) return null;

    const ranked: CrossEncoderRankedDoc<T>[] = [];
    for (const row of results) {
      const idx = Number(row?.index);
      const score = Number(row?.relevance_score ?? row?.score ?? 0);
      if (!Number.isInteger(idx) || idx < 0 || idx >= docs.length) continue;
      ranked.push({ doc: docs[idx]!, score });
    }
    return ranked.length ? ranked : null;
  } catch (e) {
    console.warn("[CrossEncoder] rerank failed:", e);
    return null;
  }
}

export async function rerankWithCrossEncoderOrLexical<T extends { pageContent?: string }>(
  query: string,
  docs: T[],
  opts: {
    crossEncoderModel?: string;
    lexicalThreshold: number;
    topN?: number;
    enableLocalRerank?: boolean;
    banditPlan?: BanditRerankPlan;
    /** 快路径：跳过 embedding/CE 二次向量化，仅用词法/本地重排 */
    skipHeavyRerank?: boolean;
  }
): Promise<{
  docs: T[];
  mode: RerankMode;
  topScore: number;
}> {
  if (!docs.length) return { docs: [], mode: "none", topScore: 0 };

  const env = getRagAgentEnv();
  const plan = opts.banditPlan;
  const dedicatedUrl = String(env.dedicatedRerankUrl ?? "").trim();
  const topN = opts.topN ?? 8;
  const skipHeavy = Boolean(opts.skipHeavyRerank);

  if (!skipHeavy && plan?.preferOnnx && env.enableOnnxRerank) {
    const onnx = await onnxRerankCandidates(query, docs, topN);
    if (onnx?.length) {
      return { docs: onnx.map((r) => r.doc), mode: "onnx_rerank", topScore: onnx[0]?.score ?? 0 };
    }
  }

  if (!skipHeavy && plan?.preferEmbedding && env.enableEmbeddingRerank) {
    const emb = await embeddingRerankCandidates(query, docs, topN, { skipIfFewCandidates: true });
    if (emb?.length) {
      return { docs: emb.map((r) => r.doc), mode: "embedding_rerank", topScore: emb[0]?.score ?? 0 };
    }
  }

  if (plan?.preferLocal && opts.enableLocalRerank) {
    const local = localRerankCandidates(query, docs, topN);
    if (local.length) {
      return { docs: local.map((r) => r.doc), mode: "local_rerank", topScore: local[0]?.score ?? 0 };
    }
  }

  const tryDedicated =
    !plan?.preferLocal &&
    !plan?.preferEmbedding &&
    (plan?.preferDedicated ?? true) &&
    env.enableDedicatedRerank &&
    Boolean(dedicatedUrl);

  if (tryDedicated && !skipHeavy) {
    const dr = await dedicatedRerankCandidates(query, docs, {
      url: dedicatedUrl,
      model: env.dedicatedRerankModel,
      topN,
    });
    if (dr?.length) {
      return {
        docs: dr.map((r) => r.doc).slice(0, topN),
        mode: "dedicated_rerank",
        topScore: dr[0]?.score ?? 0,
      };
    }
  }

  if (!skipHeavy && !plan?.preferLocal && env.enableEmbeddingRerank && !plan?.preferDedicated) {
    const emb = await embeddingRerankCandidates(query, docs, topN, { skipIfFewCandidates: true });
    if (emb?.length) {
      return {
        docs: emb.map((r) => r.doc).slice(0, topN),
        mode: "embedding_rerank",
        topScore: emb[0]?.score ?? 0,
      };
    }
  }

  if (!skipHeavy && !plan?.preferLocal && plan?.preferCrossEncoder !== false && opts.crossEncoderModel) {
    const ce = await crossEncoderRerankCandidates(query, docs, opts.crossEncoderModel, topN);
    if (ce?.length) {
      return {
        docs: ce.map((r) => r.doc).slice(0, topN),
        mode: "cross_encoder",
        topScore: ce[0]?.score ?? 0,
      };
    }
  }

  if (opts.enableLocalRerank && !plan?.preferDedicated && !plan?.preferEmbedding) {
    const local = localRerankCandidates(query, docs, topN);
    if (local.length) {
      return {
        docs: local.map((r) => r.doc),
        mode: "local_rerank",
        topScore: local[0]?.score ?? 0,
      };
    }
  }

  const lex = lexicalRerankCandidates(query, docs);
  const topScore = lex[0]?.score ?? 0;
  return {
    docs: lex.map((r) => r.doc).slice(0, topN),
    mode: "lexical",
    topScore,
  };
}

export function shouldSkipLlmRerankAfterCrossEncoder(
  mode: RerankMode,
  topScore: number,
  ceSkipThreshold: number,
  lexicalThreshold: number,
  localSkipThreshold?: number,
  embeddingSkipThreshold?: number,
  forceLlmRerank?: boolean
) {
  if (forceLlmRerank) return false;
  if (mode === "onnx_rerank" && topScore >= ceSkipThreshold) return true;
  if (mode === "embedding_rerank" && topScore >= (embeddingSkipThreshold ?? ceSkipThreshold)) return true;
  if (mode === "dedicated_rerank" && topScore >= ceSkipThreshold) return true;
  if (mode === "cross_encoder" && topScore >= ceSkipThreshold) return true;
  if (mode === "local_rerank" && topScore >= (localSkipThreshold ?? lexicalThreshold)) return true;
  if (mode === "lexical" && topScore >= lexicalThreshold) return true;
  return false;
}
