/**
 * RAG Stage-4 多轮：结构性判定 + 会话检索锚点（对齐总管 multiTurnIntent）。
 */
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

export type RagSessionRetrievalAnchor = {
  coalescedTask?: string;
  lastIntent?: string;
  topics: string[];
  updatedAt: string;
};

const REFER_MARKERS = [
  "这个",
  "那个",
  "上述",
  "同上",
  "上面",
  "前面",
  "刚才",
  "上次",
  "继续",
  "它",
  "他们",
  "前文",
  "这点",
  "呢",
] as const;

function humanTexts(messages: BaseMessage[]): string[] {
  return messages
    .filter((m) => m._getType() === "human")
    .map((m) => String(m.content ?? "").trim())
    .filter(Boolean);
}

/** 结构性多轮：轮数 + 长度比（不依赖承接词 regex 做唯一判定） */
export function shouldRunRagMultiTurnMerge(messages: BaseMessage[], lastUser: string): boolean {
  if (String(process.env.RAG_DISABLE_MULTI_TURN ?? "").trim() === "1") return false;
  const texts = humanTexts(messages);
  if (texts.length < 2) return false;
  const last = String(lastUser || "").trim();
  const prev = texts[texts.length - 2]!;
  if (!last || !prev) return false;
  if (last.length > 220) return false;
  if (last.length <= Math.max(48, Math.floor(prev.length * 0.52))) return true;
  if (prev.length >= 80 && last.length / prev.length <= 0.45) return true;
  const compact = last.replace(/\s+/g, "");
  if (compact.length <= 8 && REFER_MARKERS.some((w) => compact.includes(w))) return true;
  return false;
}

function formatRecentDialog(messages: BaseMessage[], maxRounds = 2, maxChars = 720): string {
  const rows: string[] = [];
  let rounds = 0;
  for (let i = messages.length - 1; i >= 0 && rounds < maxRounds; i--) {
    const m = messages[i]!;
    const t = m._getType();
    if (t !== "human" && t !== "ai") continue;
    const role = t === "human" ? "用户" : "助手";
    const line = `${role}：${String(m.content ?? "").trim()}`;
    if (line.length > 4) {
      rows.unshift(line);
      if (t === "human") rounds += 1;
    }
  }
  return rows.join("\n").slice(0, maxChars);
}

function tokenBagForAnchor(text: string): Set<string> {
  const s = String(text || "").toLowerCase();
  const parts = s.match(/[\p{L}\p{N}_]{2,}/gu) || [];
  return new Set(parts.slice(0, 80));
}

function anchorRelevantToQuery(anchor: string, lastUser: string, minScore = 0.12): boolean {
  const a = tokenBagForAnchor(anchor);
  const b = tokenBagForAnchor(lastUser);
  if (!a.size || !b.size) return false;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const score = inter / (a.size + b.size - inter);
  return score >= minScore;
}

/** 多轮场景下用于检索/意图 RAG 的扩展问句（结构拼接，LLM 失败时回退） */
export function buildRagMultiTurnQueryText(input: {
  messages: BaseMessage[];
  lastUser: string;
  coalesced?: string;
  sessionAnchor?: RagSessionRetrievalAnchor | null;
  suppressAnchor?: boolean;
}): { query: string; multiTurn: boolean } {
  const last = String(input.lastUser || "").trim();
  const coalesced = String(input.coalesced || "").trim();
  const multiTurn = shouldRunRagMultiTurnMerge(input.messages, last);

  if (coalesced.length >= 6) {
    return { query: coalesced.slice(0, 1200), multiTurn: true };
  }

  if (multiTurn) {
    const ctx = formatRecentDialog(input.messages, 2, 720);
    const anchor = input.suppressAnchor ? "" : String(input.sessionAnchor?.coalescedTask || "").trim();
    const parts = [anchor, ctx, last].map((s) => String(s || "").trim()).filter(Boolean);
    return { query: parts.join("\n").slice(0, 1400), multiTurn: true };
  }

  const anchorHint = input.suppressAnchor ? "" : input.sessionAnchor?.coalescedTask;
  if (anchorHint && last.length < 48 && anchorRelevantToQuery(String(anchorHint), last)) {
    return { query: `${anchorHint}\n${last}`.slice(0, 1000), multiTurn: true };
  }

  return { query: last, multiTurn: false };
}

export function anchorBoostForRagRecall(
  hit: { intent: string },
  anchor: RagSessionRetrievalAnchor | null | undefined,
): number {
  if (!anchor?.lastIntent) return 0;
  let boost = 0;
  if (hit.intent === anchor.lastIntent) boost += 0.05;
  if (anchor.topics.length && hit.intent === "fact_lookup") boost += 0.02;
  return boost;
}

export function buildRagSessionRetrievalAnchor(input: {
  coalescedTask?: string;
  lastIntent?: string;
  topics?: string[];
}): RagSessionRetrievalAnchor {
  return {
    coalescedTask: input.coalescedTask ? String(input.coalescedTask).trim().slice(0, 880) : undefined,
    lastIntent: input.lastIntent ? String(input.lastIntent).trim().slice(0, 64) : undefined,
    topics: (input.topics || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 8),
    updatedAt: new Date().toISOString(),
  };
}

export function formatSessionRetrievalAnchorBlock(anchor: RagSessionRetrievalAnchor | null | undefined): string {
  if (!anchor?.coalescedTask) return "";
  return [
    "【上轮检索任务锚点（多轮承接参考，勿硬套若本轮已切换主题）】",
    anchor.lastIntent ? `intent=${anchor.lastIntent}` : "",
    anchor.coalescedTask ? `task=${anchor.coalescedTask.slice(0, 240)}` : "",
    anchor.topics.length ? `topics=${anchor.topics.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 从 condense 上下文消息提取末轮用户句（供测试） */
export function lastHumanFromMessages(messages: BaseMessage[]): string {
  const texts = humanTexts(messages);
  return texts[texts.length - 1] || "";
}
