/**
 * 入站问句清洗：兼容总管/规划器口吻，还原为可独立理解的查数问句。
 */
import {
  DB_MANAGER_PREFIXES,
  stripPlannerContextBlock,
  stripPlanConstraintsFromQuery,
} from "#agent-shared/managerSubAgentProtocol";

const POLLUTED_LINE_MARKERS = ["知识库", "资料库", "制度汇编", "月收入情况"] as const;

function stripManagerPrefix(q: string): string {
  let s = q.trim();
  for (const p of DB_MANAGER_PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length).trim();
      break;
    }
  }
  return s;
}

function stripTrailingReport(q: string): string {
  let s = q.trim();
  if (s.endsWith("，并生成报告")) s = s.slice(0, -"，并生成报告".length).trim();
  else if (s.endsWith(",并生成报告")) s = s.slice(0, -",并生成报告".length).trim();
  else if (s.endsWith("并生成报告")) s = s.slice(0, -"并生成报告".length).replace(/[，,]\s*$/, "").trim();
  return s;
}

export function sanitizeIncomingQuestion(raw: string): string {
  let q = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!q) return "";

  q = stripPlannerContextBlock(q);
  q = stripPlanConstraintsFromQuery(q);
  q = stripManagerPrefix(q);
  q = stripTrailingReport(q);

  const lines = q
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !POLLUTED_LINE_MARKERS.some((m) => l.includes(m)));
  q = lines.join("\n").trim() || String(raw ?? "").trim();

  return q.replace(/\s+/g, " ").trim() || String(raw ?? "").trim();
}
