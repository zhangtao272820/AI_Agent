/**
 * RAG Stage-4 smoke：多轮合并 + 会话锚点（纯函数，无 API）。
 */
import { HumanMessage } from "@langchain/core/messages";
import {
  anchorBoostForRagRecall,
  buildRagMultiTurnQueryText,
  buildRagSessionRetrievalAnchor,
  shouldRunRagMultiTurnMerge,
} from "../server/utils/rag_multi_turn.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function parseMergedUnderstandForTest(raw: {
  coalesced?: string;
  retrieval_keywords?: string[];
}) {
  return {
    coalesced: String(raw.coalesced ?? "").trim() || undefined,
    retrievalKeywords: (raw.retrieval_keywords || []).map(String).filter(Boolean),
  };
}

const msgs = [
  new HumanMessage("2023年销售提成政策的主要内容是什么"),
  new HumanMessage("那退货政策呢"),
];

assert(shouldRunRagMultiTurnMerge(msgs, "那退货政策呢"), "short follow-up should trigger multi-turn");

const ragQ = buildRagMultiTurnQueryText({
  messages: msgs,
  lastUser: "那退货政策呢",
  sessionAnchor: buildRagSessionRetrievalAnchor({
    coalescedTask: "2023年销售提成政策",
    lastIntent: "document_query",
    topics: ["销售提成"],
  }),
});
assert(ragQ.multiTurn, "buildRagMultiTurnQueryText multiTurn");
assert(ragQ.query.includes("退货") || ragQ.query.length > 12, "query should include context");

const parsed = parseMergedUnderstandForTest({
  coalesced: "2023年退货政策的主要内容是什么",
  retrieval_keywords: ["退货政策", "2023年"],
});
assert(parsed.coalesced?.includes("退货"), "parseMergedUnderstandForTest");

const boost = anchorBoostForRagRecall(
  { intent: "fact_lookup" },
  buildRagSessionRetrievalAnchor({ lastIntent: "fact_lookup", topics: ["政策"] }),
);
assert(boost > 0, "anchor boost when intent aligned");

console.log("smoke-rag-stage4: OK", {
  multiTurn: ragQ.multiTurn,
  queryLen: ragQ.query.length,
  boost,
});
