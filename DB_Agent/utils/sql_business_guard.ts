/**
 * 蓝图「Validator」轻量版：不额外调 LLM，用人名是否在 SQL 文本中等启发式触发一次改写重试。
 */
import { extractNameCandidatesFromQuestion, hasExplicitOwnerQuestion } from "./nlu";

/** 问句为「某某的……」且提取的人名均未以子串形式出现在 SQL/工具入参中（可能未做人员过滤）。 */
export function sqlLikelyMissingExtractedNames(question: string, sqlOrToolInput: string): boolean {
  if (!hasExplicitOwnerQuestion(question)) return false;
  const names = extractNameCandidatesFromQuestion(question)
    .map((n) => String(n ?? "").trim())
    .filter((n) => n.length >= 2);
  if (!names.length) return false;
  const sql = String(sqlOrToolInput ?? "");
  if (!sql.trim()) return false;
  for (const n of names) {
    if (sql.includes(n)) return false;
  }
  return true;
}
