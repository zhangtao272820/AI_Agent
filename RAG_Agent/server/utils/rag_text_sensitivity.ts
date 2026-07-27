/**
 * RAG 对中文、数字、时间表达的结构化敏感度（检索问句保真）。
 */
import { normalizeFullwidthDigits } from "./rag_text_sensitivity_digits";

const NUMERIC_RUN = /[\d０-９]+(?:[.:：／/%-][\d０-９]+)?%?|[一二三四五六七八九十百千万两〇零]+/g;

export function numericLiteralsIn(text: string): string[] {
  return (normalizeFullwidthDigits(String(text || "")).match(NUMERIC_RUN) || []).slice(0, 12);
}

/** 保留用户原话中的数字与中文数字到检索句 */
export function preserveQueryLiterals(userMessage: string, query: string): string {
  const raw = String(userMessage || "").trim();
  const q = String(query || "").trim();
  if (!raw || !q) return q || raw;
  const nums = numericLiteralsIn(raw);
  if (!nums.length) return q;
  const missing = nums.filter((n) => !q.includes(n));
  if (!missing.length) return q;
  return `${q} ${missing.slice(0, 4).join(" ")}`.trim();
}

export function enrichRagQuerySensitivity(query: string, rawMessage?: string): string {
  const q = normalizeFullwidthDigits(String(query || "").trim());
  const raw = String(rawMessage || "").trim();
  if (!raw || raw === q) return q;
  return preserveQueryLiterals(raw, q);
}
