import { filterTextsRelevantToQuery, filterTopicsRelevantToQuery } from "./preference_context_gate";
import {
  clearRagSessionMemoryPg,
  getRagSessionMemoryPg,
  updateRagSessionMemoryPg,
  type LayeredSessionMemory
} from "../../utils/session_memory_store";

export type { LayeredSessionMemory };

export function getSessionMemory(sessionId: string): LayeredSessionMemory {
  return getRagSessionMemoryPg(sessionId);
}

export function updateSessionMemory(
  sessionId: string,
  patch: Partial<Pick<LayeredSessionMemory, "summary" | "topics">>
) {
  updateRagSessionMemoryPg(sessionId, patch);
}

export function clearSessionMemory(sessionId: string) {
  clearRagSessionMemoryPg(sessionId);
}

/** 从用户问句提取简短主题词，供分层记忆 */
export function extractTopicKeywords(text: string, max = 4): string[] {
  const s = String(text ?? "").trim();
  if (!s) return [];
  const cjk = s.match(/[\u4e00-\u9fff]{2,8}/g) ?? [];
  const ascii = s.match(/[a-zA-Z][a-zA-Z0-9_]{2,}/g) ?? [];
  const stop = new Set(["什么", "怎么", "如何", "哪些", "是否", "请问", "文档", "查询", "检索"]);
  const out: string[] = [];
  for (const t of [...cjk, ...ascii.map((x) => x.toLowerCase())]) {
    if (stop.has(t) || t.length < 2) continue;
    if (out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function mergeTopics(existing: string[], incoming: string[], maxTopics = 8): string[] {
  const merged = [...incoming, ...existing];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of merged) {
    const k = String(t || "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= maxTopics) break;
  }
  return out;
}

/** 注入 Agent 的摘要文本：全局摘要 + 主题层（调用方应按当前问句做相关性过滤） */
export function buildAgentSummaryInjection(mem: LayeredSessionMemory): string {
  const parts: string[] = [];
  const summary = String(mem.summary ?? "").trim();
  if (summary) parts.push(summary);
  const topics = (mem.topics ?? []).filter(Boolean);
  if (topics.length) parts.push(`用户持续关注主题：${topics.join("、")}`);
  return parts.join("\n");
}

/** 按句切分摘要/主题后由模型判断相关性，避免整段污染 */
export async function buildFilteredAgentSummaryInjection(
  mem: LayeredSessionMemory,
  query: string
): Promise<string> {
  const raw = buildAgentSummaryInjection(mem);
  const q = String(query || "").trim();
  if (!raw.trim() || !q) return "";
  const parts = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const kept = await filterTextsRelevantToQuery(q, parts);
  return kept.join("\n");
}

/** 仅保留与当前问句相关的会话主题词 */
export async function filterSessionTopicsForQuery(
  query: string,
  topics: string[] | undefined | null
): Promise<string[]> {
  return filterTopicsRelevantToQuery(query, topics);
}
