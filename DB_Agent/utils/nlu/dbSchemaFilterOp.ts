/**
 * 筛选比较符推断：完整字面值 + 名称类列 → 等值匹配，避免 LIKE 误匹配多行。
 * 不读问句、不用业务词表。
 */
export type SchemaFilterOp = "=" | "!=" | "like" | ">" | "<" | ">=" | "<=" | "in";

export function inferSchemaFilterOp(value: string, columnName: string): SchemaFilterOp {
  const v = String(value ?? "").trim();
  const col = String(columnName ?? "").trim().toLowerCase();
  if (!v || v.includes("%") || v.includes("_")) return "like";
  if (/^\d+$/.test(v)) return "=";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return "=";
  if (
    col.endsWith("_name") ||
    col.endsWith("_title") ||
    col.endsWith("_code") ||
    col === "name" ||
    col === "title" ||
    col === "code"
  ) {
    return "=";
  }
  return "like";
}
