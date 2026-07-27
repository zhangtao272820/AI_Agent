function normalizeQuestionKey(question: string): string {
  return String(question ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，,。.;；:：!?？]/g, "")
    .slice(0, 120);
}

function charOverlapScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const setA = new Set(a.split(""));
  const setB = new Set(b.split(""));
  let inter = 0;
  for (const c of setA) if (setB.has(c)) inter += 1;
  return inter / Math.max(setA.size, setB.size, 1);
}

function extractTimeTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const s = String(text || "");
  for (const m of s.matchAll(/\d{4}年?|\d{1,2}月|Q[1-4]|近\s*\d+\s*[个]?月|上[个]?月|本[个]?月|去[年]|今[年]|本季度|上季度/gi)) {
    tokens.add(m[0].toLowerCase().replace(/\s/g, ""));
  }
  for (const y of s.match(/\d{4}/g) ?? []) tokens.add(y);
  return tokens;
}

/** 经验问句与当前问句是否足够对齐，才允许直出 SQL（写入学习不受影响）。 */
export function experienceSqlDirectAlignsWithQuestion(storedQuestion: string, currentQuestion: string): boolean {
  const storedKey = normalizeQuestionKey(storedQuestion);
  const currentKey = normalizeQuestionKey(currentQuestion);
  if (!storedKey || !currentKey) return false;

  const overlap = charOverlapScore(storedKey, currentKey);
  const minOverlap = Number(process.env.DB_EXPERIENCE_SQL_DIRECT_MIN_OVERLAP ?? 0.58);
  const threshold = Number.isFinite(minOverlap) && minOverlap >= 0.4 && minOverlap <= 0.95 ? minOverlap : 0.58;
  if (overlap < threshold) return false;

  const storedTime = extractTimeTokens(storedQuestion);
  const currentTime = extractTimeTokens(currentQuestion);
  if (storedTime.size > 0 && currentTime.size > 0) {
    let shared = 0;
    for (const t of storedTime) if (currentTime.has(t)) shared += 1;
    if (shared === 0) return false;
  }

  return true;
}
