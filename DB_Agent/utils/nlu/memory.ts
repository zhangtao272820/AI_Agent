import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { sanitizeAssistantText } from "../text";
import { clipText, sanitizeHistoryForCondense } from "./text";

function normalizeQuestionForCache(question: string) {
  let q = String(question ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[\u3000\r\n\t]/g, "")
    .replace(/[，,。.;；:："'“”‘’（）()\[\]{}<>《》【】!?？]/g, "");
  q = q
    .replace(/老年人/g, "老人")
    .replace(/全体|所有|全部|总体/g, "全部")
    .replace(/统计一下|统计|查询一下|查一下|查查|查询|帮我|麻烦|请问|给我|一下|看看|我要|我想/g, "");
  q = q.replace(/的/g, "");
  return q.trim();
}

function isCorrectionQuestion(question: string) {
  const q = String(question ?? "").trim();
  if (!q) return false;
  const markers = ["不是", "不对", "纠正", "更正", "改成", "改为", "你刚才", "上面说", "刚刚说"];
  return markers.some((m) => q.includes(m));
}

export function getMessageRole(m: any): "human" | "ai" | "other" {
  const t = String(m?._getType?.() ?? m?.getType?.() ?? m?.type ?? m?.role ?? "")
    .toLowerCase()
    .trim();
  if (t.includes("human") || t === "user") return "human";
  if (t.includes("ai") || t.includes("assistant")) return "ai";
  return "other";
}

function isCacheableAnswer(text: string) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (t.startsWith("查询失败")) return false;
  if (t.includes("我没能完成这个统计查询")) return false;
  if (t.includes("我没有在数据库里查到你要的信息")) return false;
  const emptyMarkers = ["没有查到", "未查到", "未找到", "查不到", "暂无数据", "没有数据", "结果为空"];
  if (emptyMarkers.some((m) => t.includes(m))) return false;
  return true;
}

function filterBadHistoryTurns(messages: BaseMessage[]) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const out: BaseMessage[] = [];
  let pendingHuman: BaseMessage | null = null;
  for (const msg of messages) {
    const role = getMessageRole(msg as any);
    if (role === "human") {
      pendingHuman = msg;
      continue;
    }
    if (role === "ai") {
      const ans = String((msg as any)?.content ?? "").trim();
      if (isCacheableAnswer(ans)) {
        if (pendingHuman) out.push(pendingHuman);
        out.push(msg);
      }
      pendingHuman = null;
      continue;
    }
    pendingHuman = null;
  }
  return out;
}

export function findRepeatAnswer(chatHistory: BaseMessage[] | undefined, question: string) {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) return null;
  const q = String(question ?? "").trim();
  if (!q) return null;
  if (isCorrectionQuestion(q)) return null;
  const cur = normalizeQuestionForCache(q);
  if (!cur) return null;
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const msg = chatHistory[i] as any;
    if (getMessageRole(msg) !== "human") continue;
    const prevQ = String(msg?.content ?? "").trim();
    if (!prevQ) continue;
    const prev = normalizeQuestionForCache(prevQ);
    if (!prev || prev !== cur) continue;
    for (let j = i + 1; j < chatHistory.length; j++) {
      const am = chatHistory[j] as any;
      if (getMessageRole(am) !== "ai") continue;
      const ans = String(am?.content ?? "").trim();
      if (isCacheableAnswer(ans)) return ans;
      return null;
    }
    return null;
  }
  return null;
}

export function trimChatHistoryForModel(
  messages: BaseMessage[],
  maxMessages = 6,
  maxCharsTotal = 1200,
  maxCharsPerMessage = 320,
) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const filtered = filterBadHistoryTurns(messages);
  if (filtered.length === 0) return [];
  const picked = filtered.slice(Math.max(0, filtered.length - maxMessages));
  const out: BaseMessage[] = [];
  let remaining = maxCharsTotal;
  for (let i = picked.length - 1; i >= 0; i--) {
    const msg = picked[i] as any;
    const role = getMessageRole(msg);
    const raw = typeof msg?.content === "string" ? msg.content : String(msg?.content ?? "");
    const content = sanitizeHistoryForCondense(role === "ai" ? sanitizeAssistantText(raw) : raw);
    if (!content.trim()) continue;
    const clipped = clipText(content, Math.min(maxCharsPerMessage, remaining));
    if (!clipped.trim()) continue;
    remaining -= clipped.length;
    out.push(role === "ai" ? new AIMessage(clipped) : new HumanMessage(clipped));
    if (remaining <= 0) break;
  }
  return out.reverse();
}
