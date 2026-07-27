import { extractNameCandidatesFromQuestion } from "../nlu/signals";

export function maskPhone(phone: unknown) {
  if (typeof phone !== "string") return "";
  const trimmed = phone.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return trimmed;
  return digits.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2");
}

export function extractPersonName(question: string) {
  const names = extractNameCandidatesFromQuestion(question);
  return names[0] ?? null;
}

/** @deprecated 属性由 parsePersonQuery / QueryPlan LLM 解析；同步路径返回 null */
export function extractPersonAttribute(_question: string) {
  return null;
}
