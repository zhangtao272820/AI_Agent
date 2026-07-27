/**
 * 总管编排入站：从可能含 RAG/报告/图表 的复合句中，用 LLM 隔离「仅 DB 查数」问句。
 */
import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { incrementLlmCallCount } from "./llm_call_counter";
import type { ManagerDbTaskContext } from "./manager_task_context";

const IsolateSchema = z.object({
  db_question: z.string().min(2).max(900),
  is_compound: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional(),
});

function safeJsonParse(text: string): unknown {
  const s = String(text ?? "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function isManagerDbQuestionIsolateLlmEnabled(): boolean {
  return String(process.env.DB_MANAGER_QUESTION_ISOLATE_LLM ?? "1").trim() !== "0";
}

/** 剥离总管 exec 注入的上游事实块（协议级分隔符，非业务 regex） */
export function stripManagerUpstreamContext(text: string): string {
  const sep = "\n\n已知信息（来自上游步骤，仅供事实参考）：\n";
  return String(text ?? "").split(sep)[0]!.trim();
}

/** 编排路径已给出 scoped refined_question / prefetch 时，跳过二次 isolate LLM */
export function shouldSkipManagerDbQuestionIsolate(
  mgr?: ManagerDbTaskContext | null,
  rawQuestion?: string,
): boolean {
  if (!mgr || mgr.source !== "manager") return false;
  const refined = stripManagerUpstreamContext(String(mgr.refined_question ?? "")).trim();
  const raw = stripManagerUpstreamContext(String(rawQuestion ?? "")).trim();
  if (refined.length < 4) return false;
  if (mgr.prefetch_reuse === true || Boolean(mgr.query_plan_json?.trim())) return true;
  if (!raw) return refined.length >= 4;
  const nq = raw.replace(/\s+/g, "");
  const nr = refined.replace(/\s+/g, "");
  if (nq === nr || nr.includes(nq) || nq.includes(nr)) {
    const ratio = Math.min(nq.length, nr.length) / Math.max(nq.length, nr.length);
    return ratio >= 0.55;
  }
  return false;
}

/**
 * 启发模型：从总管传入的复合/包装问句中提取可独立执行的 DB 自然语言问句。
 */
export async function isolateManagerDbQuestionByLlm(
  model: ChatOpenAI | null,
  rawQuestion: string,
  mgr?: ManagerDbTaskContext | null,
): Promise<string | null> {
  if (!model || !isManagerDbQuestionIsolateLlmEnabled()) return null;
  const raw = String(rawQuestion ?? "").trim();
  if (!raw || raw.length < 6) return null;
  const refined = String(mgr?.refined_question ?? "").trim();
  const hint = refined && refined !== raw ? `总管 refined_question：${refined.slice(0, 480)}` : "";

  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是数据库问句隔离器。输入可能来自多 Agent 编排（含知识库检索、报告、图表、办公等非 DB 指令）。",
          "只输出 JSON，禁止 markdown。",
          "任务：提取「仅数据库只读查询」这一步的自然语言问句 db_question。",
          "规则：",
          "- 去掉知识库/RAG、报告撰写、可视化、办公日程等非 DB 部分。",
          "- 保留地区、年龄段、指标、时间、对象等 SQL 相关语义。",
          "- 若输入已是单一 DB 问句，原样输出（可略去礼貌用语）。",
          "- 禁止编造表名或未提及条件。",
          'schema: {"db_question":string,"is_compound":bool,"confidence":0-1,"rationale":string}',
        ].join("\n"),
      ],
      ["human", [raw.slice(0, 900), hint].filter(Boolean).join("\n\n")],
    ]);
    const parsed = IsolateSchema.safeParse(
      safeJsonParse(String((res as { content?: string })?.content ?? "")),
    );
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null;
    const q = String(parsed.data.db_question ?? "").trim();
    return q.length >= 2 ? q.slice(0, 900) : null;
  } catch {
    return null;
  }
}

/** manager refined_question 比入站问句更完整时优先（长度/包含，无领域词表） */
export function pickManagerDbStandaloneQuestion(
  rawQuestion: string,
  mgr?: ManagerDbTaskContext | null,
  isolated?: string | null,
): string {
  const raw = stripManagerUpstreamContext(String(rawQuestion ?? "")).trim();
  const iso = String(isolated ?? "").trim();
  const refined = stripManagerUpstreamContext(String(mgr?.refined_question ?? "")).trim();
  if (iso.length >= 4) return iso;
  if (refined.length >= 4 && raw.length >= 4) {
    if (refined.length > raw.length + 8 || (raw.includes(refined) && refined.length >= 8)) return refined;
    if (refined.includes(raw) && refined.length > raw.length) return refined;
  }
  return raw;
}
