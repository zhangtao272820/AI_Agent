/**
 * 将数据库原始值结合列名、注释、数据类型转为用户可读文案（枚举、0/1 标志位等）。
 */
import { loadDomainPatch } from "./domain_patch";

export function parseEnumMapFromComment(comment: string) {
  const c = String(comment ?? "").trim();
  if (!c) return null;
  const re = /(^|[，,;；\s/])(\d+)\s*[:：=]?\s*([^\s，,;；/()（）]{1,12})/g;
  const map = new Map<string, string>();
  let m: RegExpExecArray | null = null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(c))) {
    const key = String(m[2] ?? "").trim();
    const val = String(m[3] ?? "").trim();
    if (key && val && !map.has(key)) map.set(key, val);
  }
  if (map.size < 2) return null;
  return map;
}

function normalize01(raw: unknown): "0" | "1" | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "boolean") return raw ? "1" : "0";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw === 0) return "0";
    if (raw === 1) return "1";
    return null;
  }
  const s = String(raw).trim();
  if (s === "0" || s === "1") return s as "0" | "1";
  return null;
}

function commentIncludesAny(comment: string, parts: readonly string[]): boolean {
  const c = String(comment ?? "");
  return parts.some((p) => p && c.includes(p));
}

function columnNameMatchesPatterns(columnName: string, patterns: string[]): boolean {
  const n = String(columnName ?? "").toLowerCase();
  return patterns.some((p) => {
    const pat = String(p ?? "").toLowerCase();
    return pat && (n.includes(pat) || n.startsWith(pat));
  });
}

function isYnStyleColumn(columnName: string): boolean {
  const rules = loadDomainPatch().displayRules;
  const patterns = rules.yn_column_patterns ?? ["is_yn", "yn_"];
  return columnNameMatchesPatterns(columnName, patterns);
}

function isCompletionContext(columnName: string, comment: string): boolean {
  const rules = loadDomainPatch().displayRules;
  const c = String(comment ?? "");
  const k = String(columnName ?? "").toLowerCase();
  if (commentIncludesAny(c, rules.completion_context_keywords ?? [])) return true;
  const suffixes = rules.column_suffix_completion ?? [];
  if (suffixes.some((s) => k.endsWith(String(s).toLowerCase()))) return true;
  return false;
}

function ynLabelFor01(key: string, comment: string, bit: "0" | "1"): string | null {
  const rules = loadDomainPatch().displayRules;
  const c = String(comment ?? "");
  const kl = key.toLowerCase();
  const patch = loadDomainPatch();

  for (const [col, map] of Object.entries(patch.valueMaps)) {
    if (key.toLowerCase().includes(col.split(".")[1] ?? col) || col.endsWith(key)) {
      const hit = Object.entries(map).find(([, v]) => v === bit);
      if (hit) return `${hit[0]}（${bit}）`;
    }
  }

  if (kl.includes("sync") || commentIncludesAny(c, rules.sync_keywords ?? ["同步"])) {
    return bit === "1" ? "已同步" : "未同步";
  }
  if (commentIncludesAny(c, rules.enable_keywords ?? []) || kl.includes("enable") || kl.includes("active")) {
    return bit === "1" ? "已启用" : "未启用";
  }
  if (isCompletionContext(key, c)) {
    return bit === "1" ? "已完成" : "未完成";
  }
  const yesMarker = rules.yes_no_comment_marker ?? "是否";
  if (c.includes(yesMarker)) {
    return bit === "1" ? "是" : "否";
  }
  if (isYnStyleColumn(key)) {
    return bit === "1" ? "是（1）" : "否（0）";
  }
  return null;
}

/**
 * 面向用户展示的单字段值：优先注释中的枚举表；其次 is_yn / tinyint(1) 等 0/1 语义。
 */
export function formatFieldValueForUser(
  columnName: string,
  comment: string,
  dataType: string,
  rawValue: unknown,
): string {
  if (rawValue === null || rawValue === undefined) return "（空）";

  const enumMap = parseEnumMapFromComment(comment);
  if (enumMap) {
    const v = String(rawValue).trim();
    const mapped = enumMap.get(v);
    if (mapped) return `${mapped}（${v}）`;
  }

  const dt = String(dataType ?? "").toLowerCase();
  const tinyish = dt.includes("tinyint") || dt === "bit" || dt === "bool" || dt === "boolean";
  const bit = normalize01(rawValue);
  if (bit && (tinyish || isYnStyleColumn(columnName))) {
    const yn = ynLabelFor01(columnName, comment, bit);
    if (yn) return `${yn}（原始值 ${bit}）`;
  }

  if (typeof rawValue === "string") return rawValue.length > 400 ? `${rawValue.slice(0, 400)}…` : rawValue;
  if (typeof rawValue === "number" || typeof rawValue === "boolean") return String(rawValue);
  try {
    const j = JSON.stringify(rawValue);
    return j.length > 400 ? `${j.slice(0, 400)}…` : j;
  } catch {
    const s = String(rawValue);
    return s.length > 400 ? `${s.slice(0, 400)}…` : s;
  }
}
