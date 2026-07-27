/**
 * P8 进程内语义重排：复用 embedding 模型对候选做余弦相似度排序，无需外部 HTTP / ONNX 文件。
 */
import { getRagAgentEnv } from "./rag_agent_env";
import { embedQueryCached, getRagEmbeddings } from "./embedding_query_cache";
import type { CrossEncoderRankedDoc } from "./cross_encoder_rerank";

function cosine(a: number[], b: number[]): number {
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

/** 对候选片段做 embedding 余弦重排；失败时返回 null（由上层回退） */
export async function embeddingRerankCandidates<T extends { pageContent?: string }>(
  query: string,
  docs: T[],
  topN = 8,
  opts?: { skipIfFewCandidates?: boolean }
): Promise<CrossEncoderRankedDoc<T>[] | null> {
  if (!docs.length || !String(query || "").trim()) return null;
  if (!process.env.OPENAI_API_KEY) return null;
  if (opts?.skipIfFewCandidates && docs.length <= topN) return null;

  const embeddings = getRagEmbeddings();
  const q = String(query).slice(0, 500);
  const texts = docs.map((d) => String(d.pageContent ?? "").slice(0, 800));

  try {
    const env = getRagAgentEnv();
    const batchSize = Math.max(1, Math.min(10, env.embeddingBatchSize));
    const queryVec = await embedQueryCached(embeddings, q);
    if (!queryVec) return null;

    const docVecs: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const chunk = texts.slice(i, i + batchSize);
      const vecs = await embeddings.embedDocuments(chunk);
      docVecs.push(...vecs);
    }

    const ranked: CrossEncoderRankedDoc<T>[] = [];
    for (let i = 0; i < docs.length; i++) {
      const score = cosine(queryVec, docVecs[i] ?? []);
      ranked.push({ doc: docs[i]!, score });
    }
    ranked.sort((a, b) => b.score - a.score || String(b.doc.pageContent).length - String(a.doc.pageContent).length);
    return ranked.slice(0, topN);
  } catch (e) {
    console.warn("[EmbeddingRerank] failed:", e);
    return null;
  }
}

export function getEmbeddingRerankStatus() {
  const env = getRagAgentEnv();
  return {
    enabled: env.enableEmbeddingRerank,
    embeddingModel: env.embeddingModel,
    skipLlmThreshold: env.embeddingRerankSkipLlmThreshold,
  };
}
