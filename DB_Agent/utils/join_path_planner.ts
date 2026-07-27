/**
 * P6-B：多表 Join 最短路径规划（schema 关系图 BFS）。
 */
import type { SchemaRelation } from "./schema_relations";
import type { QueryIrJoin } from "./query_ir";
import { clipText } from "./nlu/text";

type Edge = {
  table: string;
  column: string;
  otherTable: string;
  otherColumn: string;
  relation: SchemaRelation;
};

function buildAdjacency(relations: SchemaRelation[]): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>();
  const add = (a: string, colA: string, b: string, colB: string, rel: SchemaRelation) => {
    if (!a || !b) return;
    const e: Edge = { table: a, column: colA, otherTable: b, otherColumn: colB, relation: rel };
    const list = adj.get(a) ?? [];
    list.push(e);
    adj.set(a, list);
  };
  for (const r of relations) {
    add(r.from_table, r.from_column, r.to_table, r.to_column, r);
    add(r.to_table, r.to_column, r.from_table, r.from_column, r);
  }
  return adj;
}

function bfsPath(adj: Map<string, Edge[]>, start: string, goal: string): SchemaRelation[] | null {
  if (start === goal) return [];
  const queue: string[] = [start];
  const prev = new Map<string, { from: string; edge: Edge }>();
  const seen = new Set<string>([start]);

  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of adj.get(cur) ?? []) {
      if (seen.has(e.otherTable)) continue;
      seen.add(e.otherTable);
      prev.set(e.otherTable, { from: cur, edge: e });
      if (e.otherTable === goal) {
        const path: SchemaRelation[] = [];
        let node = goal;
        while (node !== start) {
          const p = prev.get(node);
          if (!p) break;
          path.unshift(p.edge.relation);
          node = p.from;
        }
        return path;
      }
      queue.push(e.otherTable);
    }
  }
  return null;
}

/** 连接多表的最小 Join 边集（Steiner 近似：从首表 BFS 到其余表）。 */
export function planJoinPath(relations: SchemaRelation[], tables: string[]): SchemaRelation[] {
  const uniq = Array.from(new Set(tables.filter(Boolean)));
  if (uniq.length <= 1) return [];
  const adj = buildAdjacency(relations);
  const used = new Set<string>();
  const out: SchemaRelation[] = [];
  const connected = new Set<string>([uniq[0]!]);

  for (let i = 1; i < uniq.length; i++) {
    const target = uniq[i]!;
    if (connected.has(target)) continue;
    let best: SchemaRelation[] | null = null;
    let bestLen = Infinity;
    for (const start of connected) {
      const path = bfsPath(adj, start, target);
      if (path && path.length < bestLen) {
        best = path;
        bestLen = path.length;
      }
    }
    if (!best?.length) continue;
    for (const rel of best) {
      const key = `${rel.from_table}.${rel.from_column}|${rel.to_table}.${rel.to_column}`;
      if (used.has(key)) continue;
      used.add(key);
      out.push(rel);
      connected.add(rel.from_table);
      connected.add(rel.to_table);
    }
    connected.add(target);
  }
  return out;
}

export function joinPathToQueryIrJoins(path: SchemaRelation[]): QueryIrJoin[] {
  return path.map((r) => ({
    type: "inner" as const,
    on: `${r.from_table}.${r.from_column} = ${r.to_table}.${r.to_column}`,
  }));
}

export function formatJoinPathPlan(relations: SchemaRelation[], tables: string[]): string {
  const path = planJoinPath(relations, tables);
  if (!path.length) return "";
  const lines = path.map(
    (r) => `- JOIN ${r.to_table} ON ${r.from_table}.${r.from_column} = ${r.to_table}.${r.to_column}（${r.note}）`,
  );
  return clipText(`[Join 路径规划]\n${lines.join("\n")}`, 640);
}
