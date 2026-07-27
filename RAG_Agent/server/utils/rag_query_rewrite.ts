/**
 * 兼容层：目录锚定查询理解（通用，非领域词表）。
 */
import {
  buildCatalogGroundedQueryPlan,
  parseCatalogGroundedPlanForTest,
  isCatalogGroundedPlanEnabled,
} from "./query_plan_builder";

export type RagQueryRewriteResult = {
  leanQuery: string;
  retrievalKeywords: string[];
  subQueries: string[];
  source: "llm" | "passthrough";
};

export { isCatalogGroundedPlanEnabled as isRagQueryRewriteEnabled, parseCatalogGroundedPlanForTest as parseRagQueryRewriteForTest };

export async function rewriteRagQueryForRetrieval(input: {
  query: string;
  rawMessage?: string;
  docCatalog?: { name: string; summary?: string }[];
}): Promise<RagQueryRewriteResult> {
  const r = await buildCatalogGroundedQueryPlan(input.query, {
    rawMessage: input.rawMessage,
    docCatalog: input.docCatalog,
  });
  return {
    leanQuery: r.leanQuery,
    retrievalKeywords: r.plan.retrieval_keywords,
    subQueries: r.plan.sub_queries.length ? r.plan.sub_queries : [r.leanQuery],
    source: r.source === "llm" ? "llm" : "passthrough",
  };
}
