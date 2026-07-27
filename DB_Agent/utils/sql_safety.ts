/** 只读 SELECT 校验与 LIMIT / 超时 hint（sql_direct 与 agent 共用） */

export function isReadOnlySelectSql(sql: string) {
  const raw = String(sql ?? "").trim();
  if (!raw) return { ok: false as const, reason: "empty" as const };
  const normalized = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const s = normalized.replace(/;+\s*$/g, "").trim();
  if (!s) return { ok: false as const, reason: "empty" as const };
  if (/[;][^]*[^\s]/.test(s)) return { ok: false as const, reason: "multi_statement" as const };
  if (!/^(select|with)\b/i.test(s)) return { ok: false as const, reason: "not_select" as const };
  if (/\b(insert|update|delete|drop|alter|create|truncate|replace|grant|revoke|call|load)\b/i.test(s)) {
    return { ok: false as const, reason: "write_keyword" as const };
  }
  if (/\binto\s+(outfile|dumpfile)\b/i.test(s) || /\bload_file\s*\(/i.test(s)) {
    return { ok: false as const, reason: "file_io" as const };
  }
  if (/\b(sleep|benchmark)\s*\(/i.test(s)) return { ok: false as const, reason: "time_bomb" as const };
  if (/\b(information_schema|performance_schema|sys)\b/i.test(s) || /\bmysql\s*\./i.test(s)) {
    return { ok: false as const, reason: "system_schema" as const };
  }
  return { ok: true as const, sql: s };
}

/** 轻量语义校验：SELECT 须含 FROM，且括号配对基本合理 */
export function validateSelectSemantics(sql: string): { ok: true } | { ok: false; reason: string } {
  const s = String(sql ?? "").trim();
  if (!/\bfrom\b/i.test(s)) return { ok: false, reason: "missing_from" };
  const opens = (s.match(/\(/g) || []).length;
  const closes = (s.match(/\)/g) || []).length;
  if (opens !== closes) return { ok: false, reason: "unbalanced_parens" };
  return { ok: true };
}

export function enforceSelectLimit(sql: string, maxLimit: number, defaultLimit: number) {
  const s = String(sql ?? "")
    .trim()
    .replace(/;+\s*$/g, "")
    .trim();
  if (!s) return s;
  if (!/\blimit\b/i.test(s)) return `${s} LIMIT ${defaultLimit}`;
  return s.replace(/\blimit\s+(\d+)(\s*,\s*(\d+))?/i, (_m, a, commaPart, b) => {
    const n1 = Number(a);
    const n2 = b ? Number(b) : NaN;
    if (commaPart && Number.isFinite(n1) && Number.isFinite(n2)) {
      const safeN2 = Math.max(1, Math.min(maxLimit, Math.floor(n2)));
      return `LIMIT ${Math.max(0, Math.floor(n1))}, ${safeN2}`;
    }
    if (Number.isFinite(n1)) {
      return `LIMIT ${Math.max(1, Math.min(maxLimit, Math.floor(n1)))}`;
    }
    return `LIMIT ${Math.max(1, Math.min(maxLimit, defaultLimit))}`;
  });
}

export function injectMysqlMaxExecutionTimeHint(sql: string, ms: number) {
  const s = String(sql ?? "").trim();
  if (!s) return s;
  if (/max_execution_time\s*\(/i.test(s)) return s;
  const hint = `/*+ MAX_EXECUTION_TIME(${Math.max(1, Math.floor(ms))}) */`;
  return s.replace(/\bselect\b/i, (m) => `${m} ${hint}`);
}

export function extractSqlFromLlmOutput(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const fence = t.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fence?.[1]?.trim()) return fence[1].trim();
  const selectIdx = t.search(/\b(select|with)\b/i);
  if (selectIdx >= 0) {
    let sub = t.slice(selectIdx).trim();
    const semi = sub.indexOf(";");
    if (semi > 0) sub = sub.slice(0, semi + 1);
    return sub.replace(/;+\s*$/g, "").trim();
  }
  return t;
}
