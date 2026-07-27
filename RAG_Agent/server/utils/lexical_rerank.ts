import { tokenizeForKeywordSearch, scoreDocByQueryTerms } from "./retrieval_shared";

export type LexicalRankedDoc<T> = { doc: T; score: number };

/** 轻量词法重排：在 LLM Rerank 前压缩候选，高分时可跳过 LLM */
export function lexicalRerankCandidates<T extends { pageContent?: string }>(
  query: string,
  docs: T[],
  maxTerms = 16
): LexicalRankedDoc<T>[] {
  const terms = tokenizeForKeywordSearch(query).slice(0, maxTerms);
  const q = String(query ?? "").toLowerCase();
  const numbers = q.match(/\d+(?:\.\d+)?%?/g) ?? [];

  return docs
    .map((doc) => {
      const text = String(doc?.pageContent ?? "");
      const lc = text.toLowerCase();
      let score = scoreDocByQueryTerms(text, terms);
      for (const n of numbers) {
        if (lc.includes(n)) score += 3;
      }
      if (terms.length >= 2) {
        const phrase = terms.slice(0, 2).join("");
        if (lc.includes(phrase)) score += 2;
      }
      return { doc, score };
    })
    .sort((a, b) => b.score - a.score || String(b.doc.pageContent).length - String(a.doc.pageContent).length);
}

export function shouldSkipLlmRerank(topLexicalScore: number, threshold: number) {
  return topLexicalScore >= threshold;
}
