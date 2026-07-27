/**
 * 入站问句清洗：兼容总管 buildRagRetrievalMessage 包装，还原为可独立检索的核心问句。
 */
import {
  extractManagerCoreQuestion,
  looksLikeManagerRetrievalTask,
  stripPlanConstraintsFromQuery,
  stripPlannerContextBlock,
  parseManagerRagTaskFromJson,
  type ManagerRagTaskPayload,
} from "#agent-shared/managerSubAgentProtocol";
import { judgeDocScope, getRagRequestIntent } from "./doc_scope_judge";

export { extractManagerCoreQuestion, looksLikeManagerRetrievalTask, parseManagerRagTaskFromJson };
export type { ManagerRagTaskPayload };

/** 是否为闲聊（模型判断） */
export async function isLikelyChitChat(
  questionRaw: string,
  uploadedDocs: { name: string }[] = [],
): Promise<boolean> {
  const q = String(questionRaw || "").trim();
  if (!q) return true;
  const cached = getRagRequestIntent();
  if (cached) return cached.is_chitchat;
  return (await judgeDocScope(q, uploadedDocs)).is_chitchat;
}

function stripFromMarker(q: string, marker: string): string {
  const i = q.indexOf(marker);
  return i >= 0 ? q.slice(0, i).trim() : q;
}

function isManagerOutputBullet(line: string): boolean {
  const t = line.trimStart();
  const bullet = t.startsWith("-") || t.startsWith("*") || t.startsWith("•");
  return bullet && (t.includes("来源") || t.includes("标注") || t.includes("事实") || t.includes("核对"));
}

/**
 * 将用户或总管传入的文本还原为适合向量/关键词检索的问句。
 * 优先读 manager_rag_task_json.lean_query，其次解析【核心问句】。
 */
export function sanitizeIncomingQuestion(raw: string, managerTask?: ManagerRagTaskPayload | null): string {
  const taskLean = String(managerTask?.lean_query ?? "").trim();
  if (taskLean) return taskLean.split(/\s+/).join(" ").trim();

  let q = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!q) return "";

  const core = extractManagerCoreQuestion(q);
  if (core) return core.split(/\s+/).join(" ").trim();

  q = stripPlannerContextBlock(q);
  q = stripPlanConstraintsFromQuery(q);
  if (q.startsWith("【检索任务】")) {
    const nl = q.indexOf("\n");
    q = (nl >= 0 ? q.slice(nl + 1) : "").trim();
  }
  q = stripFromMarker(q, "\n【索引线索】");
  q = stripFromMarker(q, "【索引线索】");
  q = stripFromMarker(q, "\n【输出要求】");
  q = stripFromMarker(q, "【输出要求】");

  const lines = q
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (isManagerOutputBullet(l)) return false;
      if (l.startsWith("请仅依据")) return false;
      return true;
    });
  q = lines.join("\n").trim() || String(raw ?? "").trim();

  return q.split(/\s+/).join(" ").trim() || String(raw ?? "").trim();
}
