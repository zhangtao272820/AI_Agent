/**
 * 用模型判断历史偏好/摘要是否与当前问句同主题。
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createRagChatOpenAI } from "./rag_chat_openai";
import { ragFastJudgeModelName } from "./rag_agent_env";

const JUDGE_SYSTEM = [
  "你是上下文相关性判断器。",
  "给定用户「当前问题」与若干条历史偏好/摘要/证据片段，判断每条是否对检索或回答当前问题有直接帮助。",
  "同任务域、同主题、可消解指代、或用户抽象问法与文档具体字段/指标/文件名语义对应，均判 relevant=true。",
  "来自其他独立任务、上一轮不同主题的片段，与当前问句无关时应判为不相关。",
  "仅输出 JSON：{\"results\":[{\"index\":0,\"relevant\":true}]}",
  "index 从 0 开始，relevant 为布尔值。不要输出其它文字。",
].join("\n");

function parseJudgeFlags(modelText: string, count: number): boolean[] {
  const out = new Array<boolean>(count).fill(false);
  const t = String(modelText ?? "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return out;
  try {
    const parsed = JSON.parse(t.slice(start, end + 1)) as { results?: Array<{ index?: number; relevant?: boolean }> };
    const rows = Array.isArray(parsed?.results) ? parsed.results : [];
    for (const row of rows) {
      const i = Number(row?.index);
      if (!Number.isInteger(i) || i < 0 || i >= count) continue;
      out[i] = Boolean(row.relevant);
    }
  } catch {
    /* 解析失败：保守丢弃全部历史片段 */
  }
  return out;
}

async function invokeRelevanceJudge(query: string, items: string[]): Promise<boolean[]> {
  const q = String(query || "").trim();
  if (!q || !items.length) return items.map(() => false);

  const model = createRagChatOpenAI({
    modelName: ragFastJudgeModelName(),
    maxTokens: 180,
  });

  const numbered = items.map((text, i) => `[${i}] ${String(text).slice(0, 600)}`).join("\n");
  const res = await model.invoke([
    new SystemMessage(JUDGE_SYSTEM),
    new HumanMessage(`当前问题：${q}\n\n待判断片段：\n${numbered}`),
  ]);
  return parseJudgeFlags(String(res.content ?? ""), items.length);
}

/** 筛出与当前问句相关的文本条目 */
export async function filterTextsRelevantToQuery(query: string, texts: string[]): Promise<string[]> {
  const items = texts.map((t) => String(t || "").trim()).filter(Boolean);
  if (!items.length) return [];
  try {
    const flags = await invokeRelevanceJudge(query, items);
    return items.filter((_, i) => flags[i]);
  } catch {
    return [];
  }
}

export async function isContextRelevantToQuery(query: string, context: string): Promise<boolean> {
  const c = String(context || "").trim();
  if (!c) return false;
  const kept = await filterTextsRelevantToQuery(query, [c]);
  return kept.length > 0;
}

export async function filterTopicsRelevantToQuery(
  query: string,
  topics?: string[] | null
): Promise<string[]> {
  return filterTextsRelevantToQuery(query, Array.isArray(topics) ? topics : []);
}
