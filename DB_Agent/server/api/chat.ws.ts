import { defineWebSocketHandler } from "h3";
import { getDataSource } from "../../utils/db";
import {
  createConversationalRetrievalChain,
  formatChatHistory,
} from "../../utils/conversational_retrieval_chain";
import { getChatModel, getNluChatModel, getOrchestrationChatModel } from "../../utils/agent";
import { useRuntimeConfig } from "#imports";
import { ensureRateLimit } from "../../utils/rate";
import { resolveAgentRuntimeConfig } from "../../utils/runtime";
import { getRunMeta } from "../../utils/query_metrics";
import { applyPlatformModelOverrides } from "../utils/platform_config";
import { createWsThinkingSender } from "../utils/wsThinkingSender";

export default defineWebSocketHandler({
  async open(peer) {
    try {
      peer.send(JSON.stringify({ event: "status", data: "open" }));
    } catch {}
  },
  async message(peer, message) {
    try {
      ensureRateLimit((peer as any)?.ctx ?? {}, { max: 90, refillPerSec: 30 });
    } catch (e: any) {
      peer.send(JSON.stringify({ event: "error", data: e?.message ?? "请求过于频繁" }));
      return;
    }
    // WebSocket 入参约定：{ dbId?: string, messages: [{role, content}, ...] }
    let payload: any = null;
    try {
      const rawText =
        message && typeof (message as any).text === "function"
          ? (message as any).text()
          : typeof message === "string"
            ? message
            : String(message);
      payload = JSON.parse(String(rawText));
    } catch {
      peer.send(JSON.stringify({ event: "error", data: "消息格式必须为 JSON" }));
      return;
    }
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    const history = messages.slice(0, -1);
    const current = messages[messages.length - 1];
    const manager_task_json = (() => {
      if (typeof payload?.manager_task_json === "string" && String(payload.manager_task_json).trim()) {
        return String(payload.manager_task_json).trim();
      }
      if (payload?.managerTask && typeof payload.managerTask === "object") {
        try {
          return JSON.stringify(payload.managerTask);
        } catch {
          return "";
        }
      }
      return "";
    })();
    if (!current?.content) {
      peer.send(JSON.stringify({ event: "error", data: "缺少问题内容" }));
      return;
    }
    try {
      const sendThinking = createWsThinkingSender(peer);

      const runtimeConfig = useRuntimeConfig() as any;
      let config = resolveAgentRuntimeConfig(runtimeConfig, payload?.dbId);
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
        progress: sendThinking,
      });

      peer.send(JSON.stringify({ event: "status", data: "start" }));
      const resolveToolDisplayName = (tool: any, runName?: string): string => {
        const lcName = tool?.lc_kwargs?.name ?? tool?.kwargs?.name;
        if (typeof lcName === "string" && lcName.trim()) return lcName.trim();
        let raw = String(tool?.name ?? "").trim();
        const id = tool?.id;
        if ((!raw || /^langchain$/i.test(raw) || /^langgraph/i.test(raw)) && Array.isArray(id) && id.length) {
          const parts = id.map((x: any) => String(x ?? "").trim()).filter(Boolean);
          for (let i = parts.length - 1; i >= 0; i--) {
            const seg = parts[i]!;
            if (seg === "tools" || seg === "tool" || /^Runnable/i.test(seg)) continue;
            if (/^langchain$/i.test(seg) || /^langgraph/i.test(seg) || /^lc_/i.test(seg)) continue;
            if (seg.length >= 2) {
              raw = seg;
              break;
            }
          }
        }
        if (!raw || /^langchain$/i.test(raw)) {
          const rn = String(runName ?? "").trim();
          if (rn && !/^langchain$/i.test(rn) && !/^langgraph/i.test(rn)) raw = rn;
        }
        return raw;
      };
      const toolAlias = (name: string) => {
        if (!name) return "查找数据";
        const n = name.toLowerCase().replace(/-/g, "_");
        if (n.includes("schema") || n.includes("introspect") || n.includes("schem_introspect")) return "浏览数据库结构";
        if (n.includes("list_tables") || n.includes("list_tables_sql") || n.includes("sql_db_list")) return "查看数据表清单";
        if (n.includes("info_sql") || n.includes("table_info")) return "查询数据结构";
        if (n.includes("query_checker") || n.includes("checker")) return "校验查询语句";
        if (n.includes("query_sql") || n.includes("sql_db_query") || n.includes("querysql")) return "执行数据检索";
        if (n.includes("mysql_select_safe") || n.includes("mysql_select")) return "安全调取数据";
        if (n.includes("mysql_explain") || n.includes("explain")) return "分析执行计划";
        if (n.includes("sample") || n.includes("example")) return "查看样例数据";
        return `调用工具：${String(name).slice(0, 40)}`;
      };
      const toolNameByRunId = new Map<string, string>();
      const seenLlms = new Set<string>();
      const llmAlias = (runName?: string) => {
        const n = String(runName || "").toLowerCase();
        if (n.includes("rephrasequestionchain")) return "分析并理解问题";
        if (n.includes("sqlpreflightchain")) return "提炼查询要点";
        if (n.includes("routingchain")) return "规划查询方案";
        if (n.includes("statisticsrender")) return "整理统计结果";
        if (n.includes("executionchain")) return "执行分析任务";
        if (n.includes("mainconversationalchain")) return "准备最终回答";
        return "AI 思考中";
      };

      sendThinking("正在理解您的问题...");

      const result = await chain.invoke(
        {
          chat_history: formatChatHistory(history),
          question: current.content,
          ...(manager_task_json ? { manager_task_json } : {}),
          session_id: String(payload?.session_id ?? payload?.sessionId ?? "").trim(),
        },
        {
          callbacks: [
            {
              _sentStart: false as boolean,
              handleChainStart(_llm, _prompts, runId) {
                if (!(this as any)._sentStart) {
                  sendThinking("正在为您规划解决步骤...");
                  peer.send(JSON.stringify({ event: "run", data: runId }));
                  (this as any)._sentStart = true;
                }
              },
              handleLLMStart(_llm, _prompts, _runId, _parentRunId, _extra, _tags, _metadata, runName) {
                const alias = llmAlias(runName);
                if (!seenLlms.has(alias)) {
                  seenLlms.add(alias);
                  sendThinking(`当前进度：${alias}`);
                }
              },
              // token 太多会刷屏，前端已显示生成内容，此处不再发送 token
              handleToolStart(tool, _input, runId, _parentRunId, _tags, _metadata, runName) {
                const name = resolveToolDisplayName(tool, runName).trim();
                if (runId) toolNameByRunId.set(runId, name);
                sendThinking(`正在执行：${toolAlias(name)}`);
              },
              handleToolEnd(_output, runId) {
                const name = runId ? (toolNameByRunId.get(runId) ?? "") : "";
                sendThinking(`${toolAlias(name)} 已完成`);
                if (runId) toolNameByRunId.delete(runId);
              },
            },
          ],
        },
      );

      const finalText = typeof result === "string" ? result : JSON.stringify(result);
      const meta = getRunMeta();
      if (meta) peer.send(JSON.stringify({ event: "meta", data: meta }));
      peer.send(JSON.stringify({ event: "message", data: finalText }));
      sendThinking("已为您准备好回答");
      peer.send(JSON.stringify({ event: "status", data: "end" }));
    } catch (e: any) {
      peer.send(JSON.stringify({ event: "error", data: e?.message ?? String(e) }));
    }
  },
  async close(peer) {
    try {
      peer.send(JSON.stringify({ event: "status", data: "close" }));
    } catch {}
  },
});
