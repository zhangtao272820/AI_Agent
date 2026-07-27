/**
 * DB NLU smoke：意图 Playbook + 多轮结构判定（纯函数，无 API）。
 */
import { DB_INTENT_PLAYBOOK } from "../utils/nlu/dbIntentPlaybook.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function tokenBag(text: string): Set<string> {
  const parts = String(text || "").toLowerCase().match(/[\u4e00-\u9fff]+|[a-z]+|\d+/g) || [];
  return new Set(parts.slice(0, 160));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function recallDbIntentPlaybook(query: string) {
  const bag = tokenBag(query);
  let best: { id: string; score: number; intent: string } | null = null;
  for (const entry of DB_INTENT_PLAYBOOK) {
    for (const p of entry.paraphrases) {
      const score = jaccard(bag, tokenBag(p));
      if (!best || score > best.score) best = { id: entry.id, score, intent: entry.intent };
    }
  }
  return best && best.score >= 0.2 ? best : null;
}

const recall = recallDbIntentPlaybook("总分是多少");
assert(recall?.intent === "attribute_lookup", `attribute recall: ${JSON.stringify(recall)}`);

const REFER = ["呢", "这个", "那个", "继续"];
function shouldRunDbMultiTurn(last: string) {
  const t = last.replace(/\s+/g, "");
  if (t.length <= 6) return true;
  return REFER.some((w) => t.includes(w));
}
assert(shouldRunDbMultiTurn("年龄呢"), "short db follow-up multi-turn");

console.log("smoke-db-nlu: OK", { recall: recall?.id });
