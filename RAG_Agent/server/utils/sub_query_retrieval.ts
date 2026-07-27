/**
 * P2：复合问句按子问句并行检索，再与全局结果融合，避免子主题被 top-N 挤掉。
 */
import { searchKeywordCandidates } from "./vectorStore";
import type { RagAgentEnv } from "./rag_agent_env";
import {
  buildSourceLabel,
  normalizeMetadata,
  scoreDocByQueryTerms,
  tokenizeForKeywordSearch,
  uniqBy,
  type HybridDocRow,
} from "./retrieval_shared";

export type { HybridDocRow };

const docKeyFor = (metadata: Record<string, any>, pageContent: string) => {
  const sourceLabel = buildSourceLabel(metadata);
  return `${sourceLabel}:${String(pageContent ?? "").slice(0, 60)}`;
};

async function vectorHitsForQuery(
  vectorStore: any,
  query: string,
  topK: number,
  shouldFilterBySource: boolean,
  routedSources: Set<string>
) {
  const rows: Array<{ doc: any; score: number }> = [];
  const storeAny = vectorStore as any;
  if (typeof storeAny.similaritySearchWithScore === "function") {
    const hits = await storeAny.similaritySearchWithScore(query, topK);
    for (const [doc, distance] of hits as [any, number][]) {
      const metadata = normalizeMetadata(doc?.metadata);
      const source = String(metadata?.source ?? "");
      if (shouldFilterBySource && routedSources.size > 0 && !routedSources.has(source)) continue;
      rows.push({
        doc: { ...doc, metadata },
        score: 1 / (1 + Math.max(distance ?? 0, 0)),
      });
    }
    return rows;
  }
  const docs = await vectorStore.similaritySearch(query, topK);
  for (const doc of docs) {
    const metadata = normalizeMetadata(doc?.metadata);
    const source = String(metadata?.source ?? "");
    if (shouldFilterBySource && routedSources.size > 0 && !routedSources.has(source)) continue;
    rows.push({ doc: { ...doc, metadata }, score: 0.2 });
  }
  return rows;
}

/** 每个子问句独立跑向量 + 关键词，取 laneTopK 条 */
export async function retrieveParallelSubQueryLanes(params: {
  subQueries: string[];
  vectorStore: any;
  env: RagAgentEnv;
  shouldFilterBySource: boolean;
  routedSources: Set<string>;
  laneTopK: number;
  keywordLimitPerLane: number;
}): Promise<HybridDocRow[]> {
  const parts = params.subQueries
    .map((q) => String(q || "").trim())
    .filter((q) => q.length >= 5)
    .slice(0, 4);
  if (parts.length < 2) return [];

  const vectorTopK = Math.max(params.laneTopK * 2, Math.min(params.env.vectorSearchTopK, 12));
  const laneRows: HybridDocRow[] = [];

  await Promise.all(
    parts.map(async (subQuery) => {
      const [vectorHits, keywordTerms] = await Promise.all([
        vectorHitsForQuery(
          params.vectorStore,
          subQuery,
          vectorTopK,
          params.shouldFilterBySource,
          params.routedSources
        ),
        Promise.resolve(tokenizeForKeywordSearch(subQuery)),
      ]);

      const keywordHits = keywordTerms.length
        ? await searchKeywordCandidates({
            terms: keywordTerms,
            sources: params.shouldFilterBySource ? Array.from(params.routedSources) : [],
            limit: params.keywordLimitPerLane,
          })
        : [];

      const merged = new Map<string, HybridDocRow>();
      for (const hit of vectorHits) {
        const content = String(hit.doc?.pageContent ?? "");
        const meta = hit.doc?.metadata ?? {};
        const key = docKeyFor(meta, content);
        const lexical = scoreDocByQueryTerms(content, keywordTerms);
        merged.set(key, {
          key,
          doc: hit.doc,
          score: hit.score + lexical * 0.08 + 0.12,
          keywordScore: lexical > 0 ? 0.15 : 0,
          laneSubQuery: subQuery,
        });
      }
      for (const row of keywordHits) {
        const metadata = normalizeMetadata(row.metadata ?? {});
        const content = String(row.pageContent ?? "");
        const key = docKeyFor(metadata, content);
        const kwScore = Math.min(0.55, Number(row.matchedTerms ?? 0) / Math.max(1, keywordTerms.length));
        const prev = merged.get(key);
        const doc = { pageContent: content, metadata };
        merged.set(key, {
          key,
          doc,
          score: Math.max(prev?.score ?? 0, kwScore + 0.1) + scoreDocByQueryTerms(content, keywordTerms) * 0.06,
          keywordScore: Math.max(prev?.keywordScore ?? 0, kwScore),
          laneSubQuery: subQuery,
        });
      }

      const ranked = Array.from(merged.values()).sort((a, b) => b.score - a.score);
      laneRows.push(...ranked.slice(0, params.laneTopK));
    })
  );

  return uniqBy(laneRows, (row) => row.key);
}

/** 全局 hybrid 结果与子问句 lane 结果融合：lane 文档优先占位 */
export function fuseGlobalHybridWithLanes(
  globalDocs: HybridDocRow[],
  laneDocs: HybridDocRow[],
  perLaneMinSlots: number
): HybridDocRow[] {
  if (!laneDocs.length) return globalDocs;

  const subQueries = uniqBy(
    laneDocs.map((d) => String(d.laneSubQuery || "").trim()).filter(Boolean),
    (q) => q.toLowerCase()
  );
  const reserved: HybridDocRow[] = [];
  const seen = new Set<string>();

  for (const sq of subQueries) {
    const laneForSq = laneDocs
      .filter((d) => String(d.laneSubQuery || "").toLowerCase() === sq.toLowerCase())
      .sort((a, b) => b.score - a.score);
    let added = 0;
    for (const row of laneForSq) {
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      reserved.push({ ...row, score: row.score + 0.05 });
      added += 1;
      if (added >= perLaneMinSlots) break;
    }
  }

  for (const row of laneDocs) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    reserved.push(row);
  }

  const boostedGlobal = globalDocs.map((row) => {
    const laneMatch = laneDocs.find((l) => l.key === row.key);
    return laneMatch ? { ...row, score: row.score + laneMatch.score * 0.35 } : row;
  });

  return uniqBy([...reserved, ...boostedGlobal], (row) => row.key);
}
