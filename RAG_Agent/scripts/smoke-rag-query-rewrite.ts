/**
 * RAG 目录锚定查询理解 smoke（纯函数，无 API）。
 */
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function parseCatalogGroundedPlanForTest(raw: {
  lean_query?: string;
  retrieval_keywords?: string[];
  sub_queries?: string[];
}) {
  const leanQuery = String(raw.lean_query ?? raw.sub_queries?.[0] ?? "").trim();
  const retrievalKeywords = (raw.retrieval_keywords || []).map((x) => String(x ?? "").trim()).filter(Boolean);
  const subQueries = (raw.sub_queries || []).map((x) => String(x ?? "").trim()).filter(Boolean);
  return { leanQuery, retrievalKeywords, subQueries };
}

function buildFastPathRetrievalQueries(input: {
  effectiveQuery: string;
  subQueries: string[];
  retrievalKeywords: string[];
  managerKeywords?: string[];
  max?: number;
}): string[] {
  const base = String(input.effectiveQuery || "").trim();
  const max = Math.max(2, input.max ?? 4);
  const parts = [
    base,
    ...input.subQueries.slice(0, 2),
    ...input.retrievalKeywords,
    ...(input.managerKeywords ?? []),
  ]
    .map((q) => String(q || "").trim())
    .filter((q) => q.length >= 2);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= max) break;
  }
  return out.length ? out : base ? [base] : [];
}

const parsed = parseCatalogGroundedPlanForTest({
  lean_query: "产品退货审批流程",
  retrieval_keywords: ["退货", "审批", "流程", "政策"],
  sub_queries: ["产品退货审批流程"],
});
assert(parsed.leanQuery.includes("退货"), "lean_query parse");
assert(parsed.retrievalKeywords.length >= 2, "keywords parse");

const fastQueries = buildFastPathRetrievalQueries({
  effectiveQuery: "产品退货审批流程",
  subQueries: ["产品退货审批流程"],
  retrievalKeywords: ["退货政策", "审批节点", "流程步骤"],
  managerKeywords: ["售后服务"],
  max: 4,
});
assert(fastQueries.length >= 2, `fast path should keep expanded queries, got ${JSON.stringify(fastQueries)}`);

console.log("smoke-rag-query-rewrite: OK", { fastQueries });
