/** 从 LangGraph / LangChain 工具返回值提取纯文本，避免 ToolMessage 序列化 JSON 泄漏到 UI */

export function extractToolOutputText(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output.trim();
  if (typeof output !== "object") return String(output).trim();

  const o = output as Record<string, unknown>;
  if (typeof o.content === "string" && o.content.trim()) return o.content.trim();

  const kwargs = o.kwargs as Record<string, unknown> | undefined;
  if (kwargs && typeof kwargs.content === "string" && kwargs.content.trim()) {
    return String(kwargs.content).trim();
  }
  if (typeof o.output === "string" && o.output.trim()) return o.output.trim();

  return "";
}

export function isLangChainSerializedBlob(text: string): boolean {
  const s = String(text ?? "");
  if (!s.includes("{")) return false;
  return (
    /langchain_core/i.test(s) ||
    /"type"\s*:\s*"constructor"/.test(s) ||
    /"ToolMessage"|"AIMessage"|"HumanMessage"|"SystemMessage"/.test(s)
  );
}

export function stripEvidenceJsonBlocks(text: string): string {
  return String(text ?? "")
    .replace(/\[evidence_json\][\s\S]*?(?=\n\n|\n\[|$)/g, "")
    .replace(/\[retrieval_meta\][\s\S]*$/g, "")
    .replace(/\[clarify_json\][\s\S]*$/g, "")
    .replace(/^\[路由解释\][\s\S]*?\n\n/gm, "")
    .trim();
}

export function stripEvidenceMarkup(text: string): string {
  return String(text ?? "")
    .replace(/\[内容\]\s*[：:]\s*[\s\S]*?(?:\n\s*\[来源\]\s*[：:]\s*[^\n]+)?/g, "")
    .replace(/^\s*\[来源\]\s*[：:]\s*[^\n]+/gm, "")
    .replace(/^\s*\[内容\]\s*[：:]\s*[^\n]+/gm, "")
    .replace(/(?:^|\n)\s*参考\s*[：:]\s*.+?\s*$/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripLangChainJsonBlobs(text: string): string {
  let s = String(text ?? "");
  if (!isLangChainSerializedBlob(s)) return s.trim();

  s = s.replace(/```(?:json)?\s*[\s\S]*?```/gi, (block) =>
    isLangChainSerializedBlob(block) ? "" : block
  );
  s = s.replace(/\{[\s\S]*?"id"\s*:\s*\[[^\]]*langchain_core[^\]]*\][\s\S]*?\}(?:\s*$)?/gi, "");
  return s.trim();
}

/** 面向用户展示的最终回答清洗（禁止 tool / evidence JSON 泄漏） */
export function sanitizeUserFacingAnswer(text: string): string {
  let s = stripLangChainJsonBlobs(stripEvidenceJsonBlocks(String(text ?? "")));
  s = stripEvidenceMarkup(s);
  if (isLangChainSerializedBlob(s)) return "";
  return s.trim();
}

export function isAssistantGraphMessage(m: unknown): boolean {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  const id = o.id;
  if (Array.isArray(id)) {
    const path = id.map((x) => String(x)).join("/").toLowerCase();
    if (path.includes("toolmessage") || path.includes("humanmessage") || path.includes("systemmessage")) {
      return false;
    }
    if (path.includes("aimessage")) return true;
  }
  const kwargs = o.kwargs as Record<string, unknown> | undefined;
  const kwargsId = kwargs?.id;
  if (Array.isArray(kwargsId)) {
    const path = kwargsId.map((x) => String(x)).join("/").toLowerCase();
    if (path.includes("toolmessage") || path.includes("humanmessage") || path.includes("systemmessage")) {
      return false;
    }
    if (path.includes("aimessage")) return true;
  }
  const type = String(o.type ?? o._getType ?? "").toLowerCase();
  if (type.includes("tool") || type === "human" || type === "system") return false;
  if (type.includes("ai") || type === "assistant") return true;
  const role = String(o.role ?? "").toLowerCase();
  return role === "assistant" || role === "ai";
}

export function pickAssistantMessageText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!isAssistantGraphMessage(messages[i])) continue;
    const m = messages[i] as { tool_calls?: unknown[] };
    const toolCalls = m.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) continue;
    const content = pickGraphMessageText(messages[i]);
    if (content) return sanitizeUserFacingAnswer(content);
  }
  return "";
}

export function pickGraphMessageText(m: unknown): string {
  if (!m || typeof m !== "object") return "";
  const o = m as Record<string, unknown>;
  const direct = o.content;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (Array.isArray(direct)) {
    const joined = direct
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return String((part as { text: string }).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (joined) return joined;
  }
  const kwargs = o.kwargs as Record<string, unknown> | undefined;
  if (kwargs && typeof kwargs.content === "string" && kwargs.content.trim()) {
    return String(kwargs.content).trim();
  }
  return "";
}

export function isUnsafeStreamToken(text: string): boolean {
  const s = String(text ?? "");
  if (!s.trim()) return true;
  if (isLangChainSerializedBlob(s)) return true;
  if (/^\s*[\[{]/.test(s) && /"kwargs"|langchain_core|"evidence"\s*:/.test(s)) return true;
  return false;
}
