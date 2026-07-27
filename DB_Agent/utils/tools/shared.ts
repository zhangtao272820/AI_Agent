/** Shared table/column helpers for domain query tools. */
import type { DataSource } from "typeorm";
import { getHealthLinkColumnCandidates } from "../domain_patch";

export type TableColumnInfo = { name: string; comment: string; dataType: string };

export async function getTableColumns(ds: DataSource, table: string): Promise<TableColumnInfo[]> {
  const t = String(table ?? "").trim();
  if (!t) return [];
  const rows = await ds.query(
    "SELECT column_name AS name, COALESCE(column_comment,'') AS comment, COALESCE(data_type,'') AS dataType FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position",
    [t],
  );
  return Array.isArray(rows)
    ? (rows as any[]).map((r) => ({
        name: String(r?.name ?? ""),
        comment: String(r?.comment ?? ""),
        dataType: String(r?.dataType ?? ""),
      }))
    : [];
}

function pickFirstExisting(cols: TableColumnInfo[], candidates: string[]) {
  const set = new Set(cols.map((c) => String(c.name || "").toLowerCase()));
  for (const c of candidates) {
    if (set.has(String(c).toLowerCase())) return c;
  }
  return null;
}

function looksLikeIdColumn(c: TableColumnInfo) {
  const n = String(c?.name ?? "").toLowerCase();
  if (!n) return false;
  if (n === "id") return true;
  if (n.endsWith("_id")) return true;
  if (n.includes("id")) return true;
  return false;
}

function looksLikePersonKey(c: TableColumnInfo) {
  const n = String(c?.name ?? "").toLowerCase();
  const comment = String(c?.comment ?? "");
  if (!n) return false;
  if (n.includes("person")) return true;
  if (/(老人|人员|住户|长者)/.test(comment)) return true;
  return false;
}

export function pickHealthLinkCandidates(cols: TableColumnInfo[]) {
  const preferred = getHealthLinkColumnCandidates();
  const existingPreferred = preferred.filter((p) =>
    cols.some((c) => String(c.name || "").toLowerCase() === p),
  );
  const heuristic = cols
    .filter((c) => looksLikeIdColumn(c) && looksLikePersonKey(c))
    .map((c) => c.name)
    .filter(Boolean);
  const merged = [...existingPreferred, ...heuristic].map((s) => String(s).trim()).filter(Boolean);
  return Array.from(new Set(merged)).slice(0, 8);
}

export function pickHealthNameColumn(cols: TableColumnInfo[]) {
  const direct = pickFirstExisting(cols, ["person_name", "name", "elder_name", "oldman_name", "username"]);
  if (direct) return direct;
  const byComment = cols.find((c) => /姓名/.test(String(c.comment ?? "")))?.name ?? null;
  return byComment ? String(byComment) : null;
}

export function pickHealthTimeColumn(cols: TableColumnInfo[]) {
  const preferred = [
    "record_time",
    "health_time",
    "measure_time",
    "check_time",
    "exam_time",
    "report_time",
    "create_time",
    "update_time",
    "time",
    "date",
  ];
  const direct = pickFirstExisting(cols, preferred);
  if (direct) return direct;
  const byComment =
    cols.find(
      (c) =>
        /(时间|日期)/.test(String(c.comment ?? "")) &&
        /(time|date|datetime|timestamp)/i.test(String(c.dataType ?? "")),
    )?.name ??
    cols.find((c) => /(时间|日期)/.test(String(c.comment ?? "")))?.name ??
    null;
  return byComment ? String(byComment) : null;
}

export function pickFootNameColumn(cols: TableColumnInfo[]) {
  const direct = pickFirstExisting(cols, [
    "person_name",
    "name",
    "elder_name",
    "oldman_name",
    "patient_name",
    "user_name",
    "username",
  ]);
  if (direct) return direct;
  const byComment = cols.find((c) => /姓名/.test(String(c.comment ?? "")))?.name ?? null;
  return byComment ? String(byComment) : null;
}

export function pickFootTimeColumn(cols: TableColumnInfo[]) {
  const preferred = [
    "test_time",
    "measure_time",
    "report_time",
    "record_time",
    "create_time",
    "update_time",
    "time",
    "date",
  ];
  const direct = pickFirstExisting(cols, preferred);
  if (direct) return direct;
  const byComment =
    cols.find(
      (c) =>
        /(时间|日期)/.test(String(c.comment ?? "")) &&
        /(time|date|datetime|timestamp)/i.test(String(c.dataType ?? "")),
    )?.name ??
    cols.find((c) => /(时间|日期)/.test(String(c.comment ?? "")))?.name ??
    null;
  return byComment ? String(byComment) : null;
}

export function isIdKey(k: string) {
  const s = String(k || "").trim().toLowerCase();
  if (!s) return true;
  if (s === "id") return true;
  if (s.endsWith("_id")) return true;
  if (s.startsWith("id_")) return true;
  return false;
}

export function isSensitiveKey(k: string) {
  const s = String(k || "").trim().toLowerCase();
  return /(id_card|idcard|身份证|phone|mobile|tel|password|passwd|secret|token)/.test(s);
}

export function normalizeValue(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function normalizeValueKeepEmpty(v: any) {
  if (v === null || v === undefined) return "（空）";
  if (typeof v === "string") return v.trim() ? v.trim() : "（空）";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const j = JSON.stringify(v);
    return j && j !== "null" ? j : "（空）";
  } catch {
    const s = String(v);
    return s.trim() ? s.trim() : "（空）";
  }
}
