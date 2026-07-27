/**
 * RAG 证据优选 smoke（纯函数，模拟目录摘要锚定）。
 */
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function tokenize(text: string): string[] {
  const normalized = String(text || "").toLowerCase();
  const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const terms = new Set<string>();
  for (const t of cjk) {
    terms.add(t);
    if (t.length >= 4) {
      for (let i = 0; i <= t.length - 2; i++) terms.add(t.slice(i, i + 2));
    }
  }
  return [...terms];
}

function overlapScore(query: string, text: string): number {
  const hay = String(text || "").toLowerCase();
  let s = 0;
  for (const t of tokenize(query)) {
    if (hay.includes(t)) s += t.length >= 3 ? 2 : 1;
  }
  return s;
}

function prioritizeWithCatalog(
  query: string,
  effectiveQuery: string,
  items: { source?: string; content?: string }[],
  catalog: { name: string; summary?: string }[],
) {
  const queries = [effectiveQuery, query];
  const summaryBoost = new Map<string, number>();
  for (const doc of catalog) {
    let boost = 0;
    for (const q of queries) {
      boost += overlapScore(q, doc.summary ?? "") * 5;
      boost += overlapScore(q, doc.name) * 4;
    }
    summaryBoost.set(doc.name, boost);
  }
  const scored = items.map((item) => {
    let score = 0;
    for (const q of queries) {
      score += overlapScore(q, String(item.content ?? "")) * 2;
      score += overlapScore(q, String(item.source ?? "")) * 3;
    }
    for (const [name, boost] of summaryBoost) {
      if (String(item.source).includes(name)) score += boost;
    }
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const bySource = new Map<string, number>();
  for (const row of scored) {
    const src = String(row.item.source ?? "");
    bySource.set(src, (bySource.get(src) ?? 0) + row.score);
  }
  const topSource = [...bySource.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return scored.filter((r) => String(r.item.source) === topSource).map((r) => r.item);
}

const catalog = [
  {
    name: "个人月收入.txt",
    summary: "该文档展示了个人的月度财务状况：月收入6000，月支出5000",
  },
  {
    name: "养老机构服务规范.docx",
    summary: "养老机构服务规范，护理标准与补贴政策",
  },
];

const picked = prioritizeWithCatalog(
  "在知识库中检索个人的财务情况",
  "个人月度收入与支出",
  [
    { source: "养老机构服务规范.docx", content: "第二十一条 高龄老人补贴" },
    { source: "个人月收入.txt", content: "月收入6000元，月支出5000元" },
  ],
  catalog,
);
assert(
  picked.every((e) => String(e.source).includes("个人月收入")),
  `catalog boost should pick finance doc, got ${JSON.stringify(picked.map((e) => e.source))}`,
);

console.log("smoke-rag-evidence-answer: OK");
