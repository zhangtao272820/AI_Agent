/**
 * 明细快路径：用 QueryPlan.metrics + 去姓名问句 token 与表/列注释对齐，避免「仅姓名命中错表」。
 */
import type { QueryPlan } from "./nlu/query_plan";
import type { TableSchemaMeta } from "./schema_relations";
import { expandSearchTokens, stripPersonNamesFromSearchText } from "./schema_table_rank";

export function collectDetailFastPathIntentTokens(question: string, plan?: QueryPlan | null): string[] {
  const names = plan?.entities?.names ?? [];
  const qFree = stripPersonNamesFromSearchText(question, names);
  const parts = [...(plan?.metrics ?? []), ...(plan?.dimensions ?? []), qFree];
  return expandSearchTokens(parts.filter(Boolean).join(" "));
}

export function scoreTableIntentAlignment(meta: TableSchemaMeta, tokens: string[]): number {
  if (!tokens.length) return 0;
  const colBlob = meta.columns
    .slice(0, 24)
    .map((c) => `${c.name} ${c.comment}`)
    .join(" ");
  const blob = `${meta.name} ${meta.comment}\n${colBlob}`;
  let score = 0;
  for (const t of tokens) {
    if (t.length < 2) continue;
    if (!blob.includes(t)) continue;
    score += t.length >= 4 ? 3 : t.length >= 3 ? 2 : 1;
  }
  return score;
}

/** 按 schema 注释对齐分排序；无对齐分时不应走明细快路径。 */
export function rankDetailTablesByIntent(
  metas: TableSchemaMeta[],
  tokens: string[],
  orderedNames: string[],
): { name: string; score: number }[] {
  const metaByName = new Map(metas.map((m) => [m.name, m]));
  const ranked = orderedNames
    .map((name) => {
      const meta = metaByName.get(name);
      return { name, score: meta ? scoreTableIntentAlignment(meta, tokens) : 0 };
    })
    .filter((x) => x.score > 0);
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/** Schema 检索后：用 plan.metrics + 问句 token 与表 comment 对齐，把最相关表提前（通用 Core，无领域词表）。 */
export function scoreTableCommentAlignment(comment: string, tokens: string[]): number {
  const blob = String(comment ?? "");
  if (!blob.trim() || !tokens.length) return 0;
  let score = 0;
  for (const t of tokens) {
    if (t.length < 2) continue;
    if (!blob.includes(t)) continue;
    score += t.length >= 4 ? 3 : t.length >= 3 ? 2 : 1;
  }
  return score;
}

export function reorderTablesByCommentAlignment(
  tables: string[],
  comments: Record<string, string>,
  question: string,
  plan?: QueryPlan | null,
): string[] {
  const tokens = collectDetailFastPathIntentTokens(question, plan);
  if (tokens.length < 1 || tables.length < 2) return tables;
  const scored = tables
    .map((name) => ({ name, score: scoreTableCommentAlignment(comments[name] ?? "", tokens) }))
    .filter((x) => x.score > 0);
  if (!scored.length) return tables;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!.name;
  if (top === tables[0]) return tables;
  return [top, ...tables.filter((t) => t !== top)];
}
