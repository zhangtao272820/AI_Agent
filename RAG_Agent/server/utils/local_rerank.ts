/**
 * P6 离线重排：候选集内 TF-IDF + 二元组，无需外部 API。
 */
import { tokenizeForKeywordSearch } from "./retrieval_shared";

export type LocalRankedDoc<T> = { doc: T; score: number };

function docTerms(text: string, maxTerms = 24): string[] {
  return tokenizeForKeywordSearch(text).slice(0, maxTerms);
}

/** 在候选集上估计 IDF，对 query 词加权 */
export function localRerankCandidates<T extends { pageContent?: string }>(
  query: string,
  docs: T[],
  topN = 8
): LocalRankedDoc<T>[] {
  if (!docs.length) return [];

  const q = String(query ?? "").toLowerCase();
  const qTerms = docTerms(q);
  const qNumbers = q.match(/\d+(?:\.\d+)?%?/g) ?? [];
  const n = docs.length;

  const df = new Map<string, number>();
  const docTermLists = docs.map((doc) => {
    const terms = docTerms(String(doc.pageContent ?? ""));
    const seen = new Set<string>();
    for (const t of terms) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) || 0) + 1);
    }
    return terms;
  });

  const scored = docs.map((doc, i) => {
    const text = String(doc.pageContent ?? "");
    const lc = text.toLowerCase();
    const terms = docTermLists[i]!;
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);

    let score = 0;
    for (const term of qTerms) {
      const f = tf.get(term) || 0;
      if (!f) continue;
      const idf = Math.log(1 + n / (1 + (df.get(term) || 0)));
      score += f * idf;
    }

    if (qTerms.length >= 2) {
      const bigram = qTerms.slice(0, 2).join("");
      if (lc.includes(bigram)) score += 3;
    }

    for (const num of qNumbers) {
      if (lc.includes(num)) score += 4;
    }

    const lenBonus = Math.min(2, Math.log10(1 + text.length / 200));
    return { doc, score: score + lenBonus };
  });

  return scored
    .sort((a, b) => b.score - a.score || String(b.doc.pageContent).length - String(a.doc.pageContent).length)
    .slice(0, topN);
}

export function shouldSkipLlmRerankAfterLocal(topScore: number, threshold: number) {
  return topScore >= threshold;
}
