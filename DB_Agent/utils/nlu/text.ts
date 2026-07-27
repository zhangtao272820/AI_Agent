export function clipText(text: string, maxChars: number) {
  const t = String(text ?? "");
  if (maxChars <= 0) return "";
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars);
}

export function sanitizeCondensedQuestion(raw: unknown) {
  let t = typeof raw === "string" ? raw : String(raw ?? "");
  t = t.trim();
  if (!t) return "";

  const m = t.match(/<question>\s*([\s\S]*?)\s*<\/question>/i);
  if (m?.[1]) t = m[1].trim();

  t = t.replace(/<\/?(?:question|answer|system|human|assistant|user)\b[^>]*>/gi, "");

  const blocked =
    /(将下面问题改写成独立问题|仅基于历史对话|不要输出任何多余内容|只输出改写后的问题本身|don't output any extra content|only output the rewritten question)/i;
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !blocked.test(l));

  const picked = lines.find((l) => /[\u4e00-\u9fff0-9]/.test(l)) ?? lines[0] ?? "";
  t = picked
    .replace(/^["“”'`]+|["“”'`]+$/g, "")
    .replace(/^(?:-|\*|\d+\.)\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (t.length > 260) t = t.slice(0, 260).trim();
  return t;
}

export function sanitizeHistoryForCondense(raw: unknown) {
  const t = typeof raw === "string" ? raw : String(raw ?? "");
  if (!t.trim()) return "";
  const blocked =
    /(将下面问题改写成独立问题|仅基于历史对话|不要输出任何多余内容|只输出改写后的问题本身|<question>|<\/question>|<answer>|<\/answer>|don't output any extra content|only output the rewritten question)/i;
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !blocked.test(l));
  return lines.join("\n").trim();
}

export function mergeWithBudget(main: string, extra: string, maxChars: number) {
  const a = String(main ?? "");
  const b = String(extra ?? "").trim();
  if (!b) return clipText(a, maxChars);
  // 主段过长时仍保留一部分 extra（候选表/数据探索等），避免整段附加上下文被丢弃导致 Agent 无法生成 SQL
  if (a.length >= maxChars) {
    const reserve = Math.min(1100, Math.max(180, Math.floor(maxChars * 0.34)));
    const glue = "\n\n";
    const mainBudget = Math.max(200, maxChars - reserve - glue.length);
    const head = clipText(a, mainBudget);
    const tail = clipText(b, reserve);
    return tail ? `${head}${glue}${tail}` : head;
  }
  const budget = Math.max(0, maxChars - a.length);
  return a + clipText(b, budget);
}
