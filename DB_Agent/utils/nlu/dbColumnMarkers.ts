/** 列名/注释结构性 marker（includes，非业务正则分类） */

export const SENSITIVE_COLUMN_MARKERS = [
  "id_card",
  "idcard",
  "身份证",
  "phone",
  "mobile",
  "tel",
  "password",
  "passwd",
  "secret",
  "token",
] as const;

export const PERSON_NAME_COLUMN_MARKERS = [
  "姓名",
  "人员名",
  "老人名",
  "长者名",
  "住户名",
  "客户名",
  "长者姓名",
  "老人姓名",
] as const;

export const TIME_COMMENT_MARKERS = ["时间", "日期"] as const;

export const PERSON_COMMENT_MARKERS = ["老人", "人员", "住户", "长者"] as const;

export function textIncludesAny(text: string, markers: readonly string[]): boolean {
  const s = String(text ?? "");
  const lower = s.toLowerCase();
  return markers.some((m) => s.includes(m) || lower.includes(m.toLowerCase()));
}

export function isSensitiveColumnName(name: string): boolean {
  return textIncludesAny(String(name ?? "").toLowerCase(), SENSITIVE_COLUMN_MARKERS);
}

export function commentLooksLikePerson(comment: string): boolean {
  return textIncludesAny(comment, PERSON_COMMENT_MARKERS);
}

export function commentLooksLikeName(comment: string): boolean {
  return String(comment ?? "").includes("姓名");
}

export function commentLooksLikeTime(comment: string): boolean {
  return textIncludesAny(comment, TIME_COMMENT_MARKERS);
}

export function dataTypeLooksLikeTime(dataType: string): boolean {
  const d = String(dataType ?? "").toLowerCase();
  return d.includes("time") || d.includes("date") || d.includes("timestamp");
}
