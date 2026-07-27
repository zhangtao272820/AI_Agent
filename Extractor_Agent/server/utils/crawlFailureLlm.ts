/**
 * 采集失败标签：LLM 语义分类 + HTTP/状态码结构性兜底。
 */
import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";
import type { CrawlFailureTag } from "./crawl_failure_tags";

const FailureTagSchema = z.object({
  tag: z.enum([
    "captcha_or_block",
    "auth_required",
    "forbidden",
    "rate_limited",
    "timeout",
    "network",
    "browser_missing",
    "empty_dom",
    "wrong_channel",
    "low_coverage",
    "high_dup",
    "low_count",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1).optional(),
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

export function isCrawlFailureLlmEnabled(): boolean {
  return String(process.env.EXTRACTOR_FAILURE_LLM ?? "1").trim() !== "0";
}

/** 结构性：HTTP 状态码与已知运行时错误片段 */
export function classifyFailReasonStructural(msg: string): CrawlFailureTag {
  const m = String(msg || "").toLowerCase();
  if (!m) return "unknown";
  if (/\bhttp\s*40[13]\b/.test(m) || /\b403\b/.test(m)) return "forbidden";
  if (/\bhttp\s*429\b/.test(m) || /\b429\b/.test(m)) return "rate_limited";
  if (/\b401\b/.test(m)) return "auth_required";
  if (m.includes("timeout") || m.includes("timed out")) return "timeout";
  if (m.includes("econnreset") || m.includes("socket") || m.includes("network")) return "network";
  if (
    m.includes("executable doesn") ||
    m.includes("playwright install") ||
    m.includes("exitcode=127")
  ) {
    return "browser_missing";
  }
  return "unknown";
}

export async function classifyFailReasonByLlm(
  model: ChatOpenAI | null,
  msg: string,
): Promise<CrawlFailureTag | null> {
  if (!model) return null;
  const text = String(msg ?? "").trim().slice(0, 800);
  if (!text) return null;
  try {
    const res = await model.invoke([
      [
        "system",
        [
          "你是网页采集失败分类器。根据错误信息判断失败类型，只输出 JSON。",
          "勿用关键词表硬匹配；按语义与 HTTP/运行时上下文理解。",
          'schema: {"tag":"captcha_or_block|auth_required|forbidden|rate_limited|timeout|network|browser_missing|empty_dom|wrong_channel|low_coverage|high_dup|low_count|unknown","confidence":number}',
        ].join("\n"),
      ],
      ["human", text],
    ]);
    const parsed = FailureTagSchema.safeParse(safeJsonParse(String((res as { content?: string })?.content ?? "")));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null;
    return parsed.data.tag;
  } catch {
    return null;
  }
}

export async function resolveFailReason(model: ChatOpenAI | null, msg: string): Promise<CrawlFailureTag> {
  const structural = classifyFailReasonStructural(msg);
  if (structural !== "unknown") return structural;
  if (isCrawlFailureLlmEnabled()) {
    const llm = await classifyFailReasonByLlm(model, msg);
    if (llm) return llm;
  }
  return "unknown";
}
