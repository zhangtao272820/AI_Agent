/**
 * P7 专用 rerank 服务：独立 HTTP 端点（ONNX/小型 CE 网关），优先于 DashScope CE。
 */
import type { CrossEncoderRankedDoc } from "./cross_encoder_rerank";

function parseRankResults<T extends { pageContent?: string }>(
  data: unknown,
  docs: T[]
): CrossEncoderRankedDoc<T>[] | null {
  const d = data as Record<string, unknown>;
  const output = d?.output as Record<string, unknown> | undefined;
  const results =
    (Array.isArray(output?.results) ? output.results : null) ||
    (Array.isArray(d?.results) ? d.results : null) ||
    (Array.isArray(d?.data) ? d.data : null);
  if (!results?.length) return null;

  const ranked: CrossEncoderRankedDoc<T>[] = [];
  for (const row of results as Record<string, unknown>[]) {
    const idx = Number(row?.index ?? row?.document_index);
    const score = Number(row?.relevance_score ?? row?.score ?? row?.relevance ?? 0);
    if (!Number.isInteger(idx) || idx < 0 || idx >= docs.length) continue;
    ranked.push({ doc: docs[idx]!, score });
  }
  return ranked.length ? ranked : null;
}

/** 调用专用 rerank HTTP；兼容 DashScope / 通用 { query, documents, model } */
export async function dedicatedRerankCandidates<T extends { pageContent?: string }>(
  query: string,
  docs: T[],
  opts: { url: string; model?: string; apiKey?: string; topN?: number }
): Promise<CrossEncoderRankedDoc<T>[] | null> {
  const url = String(opts.url ?? "").trim();
  if (!url || !docs.length) return null;

  const documents = docs.map((d) => String(d.pageContent ?? "").slice(0, 1200));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = opts.apiKey || process.env.RAG_DEDICATED_RERANK_API_KEY || process.env.OPENAI_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model || process.env.RAG_DEDICATED_RERANK_MODEL || "bge-reranker-base",
        input: { query: String(query).slice(0, 500), documents },
        query: String(query).slice(0, 500),
        documents,
        parameters: { top_n: Math.min(opts.topN ?? 8, documents.length), return_documents: false },
        top_n: Math.min(opts.topN ?? 8, documents.length),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return parseRankResults(data, docs);
  } catch (e) {
    console.warn("[DedicatedRerank] failed:", e);
    return null;
  }
}
