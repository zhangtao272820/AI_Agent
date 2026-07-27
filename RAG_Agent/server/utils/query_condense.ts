import { createRagChatOpenAI } from "./rag_chat_openai";
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { getRagAgentEnv, chatModelName } from "./rag_agent_env";

const clampText = (text: string, max: number) => {
  const s = String(text ?? "").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const formatRecentDialogForCondense = (messages: BaseMessage[], limit: number) => {
  const rows = messages
    .filter((m) => m._getType() === "human" || m._getType() === "ai")
    .slice(-limit)
    .map((m) => {
      const role = m._getType() === "human" ? "用户" : "助手";
      return `${role}：${String(m.content ?? "").trim()}`;
    })
    .filter((line) => line.length > 3);
  return rows.join("\n");
};

const withRetry = async <T>(fn: () => Promise<T>, retries = 2, delay = 800): Promise<T> => {
  try {
    return await fn();
  } catch (error: unknown) {
    const err = error as { status?: number };
    if (retries > 0 && (err?.status === 429 || (err?.status ?? 0) >= 500)) {
      await new Promise((r) => setTimeout(r, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

/** 用 condense 模型把长问句/元指令问句改写为可独立检索的核心问句 */
export async function condenseRetrievalQuery(params: {
  summary?: string;
  messages?: BaseMessage[];
  draftQuery: string;
}): Promise<string> {
  const env = getRagAgentEnv();
  const condenseModel = createRagChatOpenAI({
    modelName: process.env.CONDENSE_MODEL ?? env.condenseModel ?? chatModelName(),
    maxTokens: 280,
  });
  const dialog = formatRecentDialogForCondense(params.messages ?? [], env.condenseRecentMessages);
  const sys = new SystemMessage(
    [
      "你是「检索问句改写」助手，只根据给定摘要与对话，把「待检索问题」改写成一条可独立用于向量检索的中文完整问句。",
      "规则：",
      "1) 消除指代：把“这个/那个/该/上述/上面/之前/刚才/它/他们/同上/前文/这点”等替换为对话里已出现的具体实体（政策名、文档主题、条款对象、指标名等）。",
      "2) 若指代无法完全还原，用对话中最近出现的明确主题词补全，不要凭空捏造新的专有名词或文件里未出现的实体。",
      "3) 保留用户原句中的时间、数字、否定、条件与核心关键词。",
      "4) 若问句含「从知识库/文档库检索」「请检索」等元指令，去掉元指令，只保留要查的主题、字段与条件。",
      "5) 用户一次问多个字段/指标时，保留全部字段关键词，不要只留其中一个。",
      "6) 只输出一条问句；不要解释、不要序号、不要引号、不要 Markdown。",
      "7) 不要把其它轮次里「文档未提及/无法从文档确定」的失败结论写进检索句；只写可检索的实体、条件与关键词。",
    ].join("\n")
  );
  const human = new HumanMessage(
    [
      `对话摘要（可能为空）：\n${clampText(String(params.summary || "（无）"), 2000)}`,
      "",
      `最近对话：\n${dialog || "（无）"}`,
      "",
      `待检索问题：\n${params.draftQuery.trim()}`,
    ].join("\n")
  );
  const res = await withRetry(() => condenseModel.invoke([sys, human]));
  let out = String(res.content ?? "").trim();
  out = out.replace(/^["'「『\s]+|["'」』\s]+$/g, "").replace(/^(改写后[：:]\s*)/, "").trim();
  if (!out) return params.draftQuery.trim();
  return clampText(out, 800);
}
