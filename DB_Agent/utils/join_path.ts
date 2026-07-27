/**
 * Join 路径提示：schema 关系 + 补丁 relations.json → 注入 SQL / QueryIR 生成。
 */
import type { QueryPlan } from "./nlu/query_plan";
import { clipText } from "./nlu/text";
import { loadDomainPatch, type JoinHintPatch } from "./domain_patch";
import type { SchemaRelation } from "./schema_relations";
import { formatJoinPathPlan } from "./join_path_planner";

function planTextBlob(plan?: QueryPlan | null): string {
  if (!plan) return "";
  return [
    ...plan.metrics,
    ...plan.dimensions,
    ...plan.filters.where,
    plan.data_domain,
    plan.intent,
  ].join(" ");
}

function patchHintApplies(hint: JoinHintPatch, tables: string[], plan?: QueryPlan | null): boolean {
  const when = hint.when_tables ?? [];
  if (!when.some((t) => tables.includes(t))) return false;
  const need = String(hint.join_only_if_question_needs ?? "").trim();
  if (!need) return true;
  const blob = planTextBlob(plan);
  if (!blob.trim()) return false;
  return need.split(/[/、,，]/).some((seg) => {
    const s = seg.trim();
    return s.length >= 2 && blob.includes(s);
  });
}

export function formatPatchJoinHints(tables: string[], plan?: QueryPlan | null): string {
  const hints = loadDomainPatch().relations.join_hints ?? [];
  const lines: string[] = [];
  for (const h of hints) {
    if (!patchHintApplies(h, tables, plan)) continue;
    if (h.sql_hint?.trim()) lines.push(`- ${h.sql_hint.trim()}`);
  }
  return lines.length ? clipText(`[补丁 JOIN 提示]\n${lines.join("\n")}`, 480) : "";
}

export function formatSchemaRelationsJoinPath(relations: SchemaRelation[], tables: string[]): string {
  if (!relations.length) return "";
  const set = new Set(tables);
  const lines = relations
    .filter((r) => set.has(r.from_table) || set.has(r.to_table))
    .slice(0, 6)
    .map((r) => `- ${r.from_table}.${r.from_column} → ${r.to_table}.${r.to_column}（${r.note}）`);
  return lines.length ? clipText(`[表关联]\n${lines.join("\n")}`, 720) : "";
}

export function buildJoinContextBlock(input: {
  tables: string[];
  relations?: SchemaRelation[];
  queryPlan?: QueryPlan | null;
}): string {
  const parts = [
    formatPatchJoinHints(input.tables, input.queryPlan),
    formatJoinPathPlan(input.relations ?? [], input.tables),
    formatSchemaRelationsJoinPath(input.relations ?? [], input.tables),
  ].filter(Boolean);
  return parts.join("\n\n");
}
