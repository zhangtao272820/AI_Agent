/**
 * 文件用途：列名/字段别名解析与默认列策略（Schema 工具辅助）。
 *
 * 主要职责：
 * - resolveColumnAlias：把用户输入的“口语化字段名/别名”映射到真实列名（基于包含匹配）。
 * - getDefaultColumns：为特定表定义默认输出列（当前返回 null，表示不做强制默认列）。
 *
 * 说明：
 * - 该文件只参与 SQL 安全查询/输出裁剪等“工具层”逻辑，不直接面向用户输出。
 */
export function resolveColumnAlias(_table: string, key: string, allCols: string[]): string | null {
  const k = String(key || "").trim();
  if (!k) return null;
  if (allCols.includes(k)) return k;
  const hit = allCols.find((c) => c.toLowerCase().includes(k.toLowerCase()));
  return hit || null;
}

export function getDefaultColumns(table: string): string[] | null {
  return null;
}
