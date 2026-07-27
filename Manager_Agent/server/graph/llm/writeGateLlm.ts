/**
 * Admin 写操作风险判定：marker 结构性 + 可选 LLM。
 */
import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";
import { looksLikeRiskyAdminWrite } from '#agent-shared/textMarkers';
import { safeJsonParse } from '../core/shared/llmJson';

const RiskSchema = z.object({
  risky: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
});

export function isAdminWriteRiskLlmEnabled(): boolean {
  return String(process.env.MANAGER_ADMIN_WRITE_RISK_LLM ?? "1").trim() !== "0";
}

export async function resolveRiskyAdminQuery(
  model: ChatOpenAI | null,
  text: string,
): Promise<boolean> {
  const structural = looksLikeRiskyAdminWrite(text);
  if (!isAdminWriteRiskLlmEnabled()) return structural;
  if (structural) return true;
  if (!model) return false;
  const t = String(text ?? "").trim().slice(0, 600);
  if (!t) return false;
  try {
    const res = await model.invoke([
      [
        "system",
        [
          "你是 admin 写操作风险判定器。判断用户是否要求创建/删除/发送待办、邮件、日程等写操作，只输出 JSON。",
          'schema: {"risky":boolean,"confidence":number}',
        ].join("\n"),
      ],
      ["human", t],
    ]);
    const parsed = RiskSchema.safeParse(safeJsonParse(String(res.content ?? "").trim()));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return structural;
    return parsed.data.risky;
  } catch {
    return structural;
  }
}

/** 同步路径：仅结构性 marker */
export function isRiskyAdminQuery(text: string): boolean {
  return looksLikeRiskyAdminWrite(text);
}
