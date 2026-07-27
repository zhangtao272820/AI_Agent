import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createRagChatOpenAI } from "./rag_chat_openai";
import { getRagAgentEnv, chatModelName } from "./rag_agent_env";

const SUMMARY_GUARD = [
  "摘要规则（必须遵守）：",
  "1) 只保留：对话中已确认的客观事实、用户持续关注主题（禁止写入「用户偏好」标题或复述路由摘要）。",
  "2) 禁止写入：某一具体问题「在文档中未找到/无法确定/检索无结果/证据不足」等检索失败类表述；不要把某一题的否定答复写成全局事实。",
  "3) 不要记录助手对旧问题的补充说明、道歉或与当前主题无关的套话。",
  "4) 输出一段简洁中文摘要。",
].join("\n");

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

/** 根据对话消息更新会话摘要（retrieve-first / 独立 UI 复用） */
export async function summarizeSessionFromMessages(params: {
  existingSummary?: string;
  messages: BaseMessage[];
}): Promise<string> {
  const summary = String(params.existingSummary ?? "").trim();
  const recent = params.messages.slice(-6);
  if (!recent.length) return summary;

  let summaryPrompt = "";
  if (summary) {
    summaryPrompt = `${SUMMARY_GUARD}\n\n以下是之前的对话摘要：${summary}\n\n请将以下新消息集成到摘要中，并输出符合上述规则的最新、简洁摘要。`;
  } else {
    summaryPrompt = `${SUMMARY_GUARD}\n\n请根据以下对话，总结出符合上述规则的关键信息，并输出一个简洁的摘要。`;
  }

  const response = await withRetry(() =>
    createRagChatOpenAI({
      modelName: process.env.SUMMARY_MODEL ?? getRagAgentEnv().summaryModel ?? chatModelName(),
    }).invoke([new SystemMessage(summaryPrompt), ...recent])
  );
  return String(response.content ?? "").trim() || summary;
}

/** 从 user/assistant 纯文本对更新摘要 */
export async function summarizeSessionFromTurns(params: {
  existingSummary?: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<string> {
  const messages: BaseMessage[] = [
    new HumanMessage(params.userMessage),
    new AIMessage(params.assistantMessage),
  ];
  return summarizeSessionFromMessages({
    existingSummary: params.existingSummary,
    messages,
  });
}
