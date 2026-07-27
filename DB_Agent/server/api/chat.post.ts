import { defineEventHandler, readBody, createError } from "h3";
import { getDataSource } from "../../utils/db";
import {
  createConversationalRetrievalChain,
  formatChatHistory,
} from "../../utils/conversational_retrieval_chain";
import { getChatModel, getNluChatModel, getOrchestrationChatModel } from "../../utils/agent";
import { useRuntimeConfig } from "#imports";
import { ensureRateLimit } from "../../utils/rate";
import { resolveAgentRuntimeConfig } from "../../utils/runtime";
import { applyPlatformModelOverrides } from "../utils/platform_config";

function sseDataChunk(text: string): string {
  const payload = JSON.stringify(String(text ?? ""));
  return `event: data\ndata: ${payload}\n\n`;
}

export default defineEventHandler(async (event) => {
  ensureRateLimit(event, { max: 60, refillPerSec: 20 });
  const body = await readBody<{
    messages: { role: string; content: string }[];
    dbId?: string;
    managerTask?: Record<string, unknown>;
    manager_task_json?: string;
    session_id?: string;
    sessionId?: string;
  }>(event);
  const messages = body?.messages ?? [];
  if (!Array.isArray(messages) || messages.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "messages 不能为空" });
  }
  const history = messages.slice(0, -1);
  const currentMessage = messages[messages.length - 1];

  const runtimeConfig = useRuntimeConfig(event) as any;
  let config = resolveAgentRuntimeConfig(runtimeConfig, body?.dbId);
  config = await applyPlatformModelOverrides(config);
  const ds = await getDataSource(config);
  const model = getChatModel(config);
  const nluModel = getNluChatModel(config);
  const orchestrationModel = getOrchestrationChatModel(config);

  const chain = createConversationalRetrievalChain({
    model,
    nluModel,
    largerModel: orchestrationModel,
    config,
    ds,
  });

  const manager_task_json = (() => {
    if (typeof body?.manager_task_json === "string" && body.manager_task_json.trim()) return body.manager_task_json.trim();
    if (body?.managerTask && typeof body.managerTask === "object") {
      try {
        return JSON.stringify(body.managerTask);
      } catch {
        return "";
      }
    }
    return "";
  })();

  const answer = await chain.invoke({
    chat_history: formatChatHistory(history),
    question: currentMessage?.content ?? "",
    ...(manager_task_json ? { manager_task_json } : {}),
    session_id: String(body?.session_id ?? body?.sessionId ?? "").trim(),
  });

  const text = typeof answer === "string" ? answer : JSON.stringify(answer ?? {});
  const bodyText = `${sseDataChunk(text)}event: end\n\n`;

  return new Response(bodyText, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
});
