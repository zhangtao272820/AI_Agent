/**
 * 蓝图「数据探索」：在生成最终 SQL 前拉取少量真实样例行（仅 sql_agent 兜底且 schema 不足时启用）。
 */
import type { DataSource } from "typeorm";
import { getDbAgentBlueprintEnv } from "./db_agent_env";
import { introspectSchemaWithComments } from "./schema";
import { clipText } from "./nlu/text";
import { reorderTablesByJudge } from "./schema_table_judge";

export async function buildExploratoryDataContext(
  ds: DataSource,
  tables: string[],
  opts?: {
    maxTables?: number;
    maxTotalChars?: number;
    progress?: (s: string) => void;
    /** 智能选表结果：优先拉主查表样例 */
    primaryTables?: string[];
  },
): Promise<string> {
  const env = getDbAgentBlueprintEnv();
  if (!env.enableExplore) return "";
  const maxT = Math.max(0, Math.min(2, opts?.maxTables ?? env.exploreMaxTables));
  const budget = Math.max(200, Math.min(800, opts?.maxTotalChars ?? env.exploreMaxChars));
  let uniq = [...new Set((tables || []).map((t) => String(t || "").trim()).filter(Boolean))];
  if (opts?.primaryTables?.length) {
    uniq = reorderTablesByJudge(uniq, {
      ranked_tables: opts.primaryTables,
      primary_tables: opts.primaryTables,
      auxiliary_tables: [],
      reasoning: "",
      sql_hint: "",
    });
  }
  uniq = uniq.slice(0, maxT);
  if (!uniq.length) return "";

  const parts: string[] = [];
  let used = 0;
  for (let i = 0; i < uniq.length; i++) {
    const table = uniq[i]!;
    if (used >= budget) break;
    const isPrimary = opts?.primaryTables?.includes(table);
    try {
      opts?.progress?.(
        isPrimary
          ? `数据探索：拉取主查表 ${table} 的样例行…`
          : `数据探索：拉取表 ${table} 的样例行…`,
      );
      const raw = await introspectSchemaWithComments(ds, `sample:${table}:2`);
      const chunk = String(raw || "").trim();
      if (!chunk || chunk.includes('失败') || chunk.toLowerCase().includes('unknown error')) continue;
      const remaining = budget - used;
      const per = Math.max(120, Math.floor(remaining / Math.max(1, uniq.length - i)));
      const clipped = clipText(chunk, per);
      const label = isPrimary ? "主查表" : "候选表";
      parts.push(`${label} ${table} 样例（至多 2 行）:\n${clipped}`);
      used += clipped.length;
    } catch {}
  }
  if (!parts.length) return "";
  const body = `[数据探索]\n以下为真实库中少量样例行，仅用于理解字段取值；编写 SQL 须自行补全 WHERE/JOIN/LIMIT。\n\n${parts.join("\n\n")}`;
  return clipText(body, budget);
}
