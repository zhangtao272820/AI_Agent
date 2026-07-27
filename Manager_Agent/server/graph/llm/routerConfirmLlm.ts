/**
 * Admin/GUI 待确认续执行：结构性 marker + 可选 LLM。
 */
import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";
import { safeJsonParse } from '../core/shared/llmJson';

const ConfirmSchema = z.object({
  is_pending_confirm: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
});

const CONFIRM_MARKERS = ["等待确认", "待确认操作", "确认继续", "请回复“确认”", '请回复"确认"'] as const;

export function isRouterConfirmLlmEnabled(): boolean {
  return String(process.env.MANAGER_ROUTER_CONFIRM_LLM ?? "1").trim() !== "0";
}

export function looksLikePendingAdminConfirmStructural(text: string): boolean {
  const t = String(text ?? "");
  return CONFIRM_MARKERS.some((m) => t.includes(m));
}

export async function looksLikePendingAdminConfirmByLlm(
  model: ChatOpenAI | null,
  text: string,
): Promise<boolean | null> {
  if (!model) return null;
  const t = String(text ?? "").trim().slice(0, 1200);
  if (!t) return null;
  try {
    const res = await model.invoke([
      [
        "system",
        [
          "判断助手消息是否在等待用户确认继续执行 admin/人工操作，只输出 JSON。",
          'schema: {"is_pending_confirm":boolean,"confidence":number}',
        ].join("\n"),
      ],
      ["human", t],
    ]);
    const parsed = ConfirmSchema.safeParse(safeJsonParse(String(res.content ?? "").trim()));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null;
    return parsed.data.is_pending_confirm;
  } catch {
    return null;
  }
}

export async function resolvePendingAdminConfirmMessage(
  model: ChatOpenAI | null,
  messages: Array<{ content?: string }>,
): Promise<{ content?: string } | null> {
  const reversed = [...messages].reverse();
  for (const m of reversed) {
    const t = String(m?.content ?? "").trim();
    if (!t) continue;
    if (looksLikePendingAdminConfirmStructural(t)) return m;
    if (isRouterConfirmLlmEnabled()) {
      const llm = await looksLikePendingAdminConfirmByLlm(model, t);
      if (llm) return m;
    }
  }
  return reversed[0] ?? null;
}
