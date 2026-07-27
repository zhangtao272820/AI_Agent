/**
 * 轻量 BM25 词法评分（进程内，不依赖外部搜索引擎）。
 */

export type Bm25Doc = {
  pageContent: string;
  metadata?: Record<string, unknown>;
};

export type Bm25Hit = Bm25Doc & {
  bm25Score: number;
};

const STOP = new Set([
  "的", "了", "是", "在", "和", "与", "或", "及", "等", "什么", "如何", "怎么", "哪些", "是否", "多少",
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with",
]);

export function tokenizeBm25(text: string): string[] {
  const raw = String(text ?? "").toLowerCase();
  const tokens: string[] = [];
  const cjk = raw.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const w of cjk) {
    if (!STOP.has(w)) tokens.push(w);
    if (w.length >= 4) {
      for (let i = 0; i + 2 <= w.length; i += 2) {
        const bi = w.slice(i, i + 2);
        if (!STOP.has(bi)) tokens.push(bi);
      }
    }
  }
  const latin = raw.match(/[a-z0-9_]{2,}/g) ?? [];
  for (const w of latin) {
    if (!STOP.has(w)) tokens.push(w);
  }
  return tokens;
}

function idf(n: number, df: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

/** 对文档集合做 BM25 排序 */
export function rankBm25Docs(docs: Bm25Doc[], queryTerms: string[], limit = 24): Bm25Hit[] {
  const terms = [...new Set(queryTerms.map((t) => String(t ?? "").trim().toLowerCase()).filter((t) => t.length >= 2))];
  if (!terms.length || !docs.length) return [];

  const k1 = 1.2;
  const b = 0.75;
  const N = docs.length;
  const tokenized = docs.map((d) => tokenizeBm25(String(d.pageContent ?? "")));
  const avgDl = tokenized.reduce((s, t) => s + t.length, 0) / Math.max(1, N);

  const df = new Map<string, number>();
  for (const term of terms) {
    let c = 0;
    for (const toks of tokenized) {
      if (toks.includes(term)) c += 1;
    }
    df.set(term, c);
  }

  const scored: Bm25Hit[] = [];
  for (let i = 0; i < docs.length; i++) {
    const toks = tokenized[i]!;
    const dl = toks.length;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of terms) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const denom = f + k1 * (1 - b + (b * dl) / Math.max(1, avgDl));
      score += idf(N, df.get(term) ?? 0) * ((f * (k1 + 1)) / Math.max(1e-6, denom));
    }
    if (score > 0) scored.push({ ...docs[i]!, bm25Score: score });
  }

  return scored.sort((a, b) => b.bm25Score - a.bm25Score).slice(0, limit);
}
