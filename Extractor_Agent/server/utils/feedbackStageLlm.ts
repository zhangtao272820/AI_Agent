/**
 * 用户负反馈 prompt patch 阶段推断：结构性 marker + 可选 LLM。
 */
import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";

export type FeedbackPatchStage = "extract" | "slot" | "plan";

const StageSchema = z.object({
  stage: z.enum(["extract", "slot", "plan"]),
  confidence: z.number().min(0).max(1).optional(),
});

const EXTRACT_MARKERS = ["字段", "抽取", "解析", "列"] as const;
const SLOT_MARKERS = ["来源", "数量", "站点", "url"] as const;

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

export function isFeedbackStageLlmEnabled(): boolean {
  return String(process.env.EXTRACTOR_FEEDBACK_STAGE_LLM ?? "1").trim() !== "0";
}

export function inferFeedbackStageStructural(text: string): FeedbackPatchStage {
  const t = String(text ?? "");
  const lower = t.toLowerCase();
  if (EXTRACT_MARKERS.some((m) => t.includes(m))) return "extract";
  if (SLOT_MARKERS.some((m) => t.includes(m) || lower.includes(m))) return "slot";
  return "plan";
}

export async function inferFeedbackStageByLlm(
  model: ChatOpenAI | null,
  text: string,
): Promise<FeedbackPatchStage | null> {
  if (!model) return null;
  const t = String(text ?? "").trim().slice(0, 600);
  if (!t) return null;
  try {
    const res = await model.invoke([
      [
        "system",
        [
          "你是爬虫反馈分类器。根据用户评论判断应优化哪一阶段 prompt，只输出 JSON。",
          "extract：字段/列/解析/抽取问题；slot：来源/数量/站点/URL；plan：其余规划/路由问题。",
          'schema: {"stage":"extract|slot|plan","confidence":number}',
        ].join("\n"),
      ],
      ["human", t],
    ]);
    const parsed = StageSchema.safeParse(safeJsonParse(String((res as { content?: string })?.content ?? "")));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null;
    return parsed.data.stage;
  } catch {
    return null;
  }
}

export async function resolveFeedbackStage(
  model: ChatOpenAI | null,
  text: string,
): Promise<FeedbackPatchStage> {
  const structural = inferFeedbackStageStructural(text);
  if (structural !== "plan" || !isFeedbackStageLlmEnabled()) return structural;
  const llm = await inferFeedbackStageByLlm(model, text);
  return llm ?? structural;
}
