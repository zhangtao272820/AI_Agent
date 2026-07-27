import type { BaseMessage } from "@langchain/core/messages";

function looksLikeShortName(text: string) {
  const t = String(text ?? "").trim();
  if (!t || t.length < 2 || t.length > 4) return false;
  for (const ch of t) {
    const code = ch.charCodeAt(0);
    const isCn = code >= 0x4e00 && code <= 0x9fff;
    if (!isCn) return false;
  }
  return true;
}

export function mergeFollowupQuestionWithHistory(
  question: string,
  chatHistory: BaseMessage[],
  getRole: (m: any) => "human" | "ai" | "other",
) {
  const q = String(question ?? "").trim();
  if (!q) return q;
  const onlyName = looksLikeShortName(q);
  if (!onlyName) return q;
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) return q;
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const m = chatHistory[i] as any;
    if (getRole(m) !== "human") continue;
    const prev = String(m?.content ?? "").trim();
    if (!prev) continue;
    const likelyDataAsk = ["记录", "明细", "报告", "日志", "历史", "最近", "最新", "信息", "档案"].some((k) =>
      prev.includes(k),
    );
    if (likelyDataAsk) {
      return prev.includes(q) ? prev : `${q}的${prev}`;
    }
    return `${q}的${prev}`;
  }
  return q;
}
