/**
 * QueryIR：自然语言条件 → 结构化 AST → MySQL SQL（P6 基础）。
 */
import type { QueryPlan } from "./nlu/query_plan";

export type QueryIrFilterOp = "=" | "!=" | ">" | "<" | ">=" | "<=" | "between" | "in" | "is null" | "is not null" | "like";

export type QueryIrFilter = {
  column: string;
  op: QueryIrFilterOp;
  value?: string | number | string[] | null;
};

export type QueryIrJoin = {
  type: "inner" | "left";
  on: string;
};

export type QueryIrOrder = {
  column: string;
  direction: "asc" | "desc";
};

export type QueryIrAggregate = {
  fn: "count" | "sum" | "avg" | "min" | "max";
  column: string;
  alias?: string;
};

export type QueryIr = {
  from_tables: string[];
  joins?: QueryIrJoin[];
  select?: string[];
  filters?: QueryIrFilter[];
  or_groups?: QueryIrFilter[][];
  aggregate?: QueryIrAggregate | null;
  group_by?: string[];
  having?: QueryIrFilter[];
  order_by?: QueryIrOrder[];
  limit?: number;
};

const FILTER_OPS = new Set<QueryIrFilterOp>([
  "=",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "between",
  "in",
  "is null",
  "is not null",
  "like",
]);

function quoteId(id: string) {
  const s = String(id ?? "").trim();
  if (!s) return "``";
  if (s.includes(".")) {
    const [a, b] = s.split(".", 2);
    if (a && b) return `\`${a.replace(/`/g, "")}\`.\`${b.replace(/`/g, "")}\``;
  }
  return `\`${s.replace(/`/g, "")}\``;
}

function escapeLiteral(v: string | number) {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

function compileFilter(f: QueryIrFilter): string | null {
  const col = quoteId(f.column);
  const op = f.op;
  if (!FILTER_OPS.has(op)) return null;
  if (op === "is null" || op === "is not null") return `${col} ${op.toUpperCase()}`;
  if (op === "between" && Array.isArray(f.value) && f.value.length >= 2) {
    return `${col} BETWEEN ${escapeLiteral(f.value[0]!)} AND ${escapeLiteral(f.value[1]!)}`;
  }
  if (op === "in" && Array.isArray(f.value) && f.value.length) {
    const vals = f.value.map((x) => escapeLiteral(x)).join(", ");
    return `${col} IN (${vals})`;
  }
  if (f.value == null || f.value === "") return null;
  if (op === "like") {
    const v = f.value;
    if (typeof v === "string" || typeof v === "number") return `${col} LIKE ${escapeLiteral(v)}`;
    return null;
  }
  if (typeof f.value === "string" || typeof f.value === "number") {
    return `${col} ${op} ${escapeLiteral(f.value)}`;
  }
  return null;
}

export function parseQueryIr(raw: unknown): QueryIr | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const from_tables = (Array.isArray(o.from_tables) ? o.from_tables : [])
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
  if (!from_tables.length) return null;

  const parseFilters = (arr: unknown): QueryIrFilter[] =>
    (Array.isArray(arr) ? arr : [])
      .map((x) => x as Record<string, unknown>)
      .map((f) => ({
        column: String(f.column ?? "").trim(),
        op: String(f.op ?? "=").trim().toLowerCase() as QueryIrFilterOp,
        value: f.value as QueryIrFilter["value"],
      }))
      .filter((f) => f.column && FILTER_OPS.has(f.op));

  const joins = (Array.isArray(o.joins) ? o.joins : [])
    .map((j) => j as Record<string, unknown>)
    .map((j) => ({
      type: String(j.type ?? "inner").toLowerCase() === "left" ? ("left" as const) : ("inner" as const),
      on: String(j.on ?? "").trim(),
    }))
    .filter((j) => j.on);

  const select = (Array.isArray(o.select) ? o.select : []).map((x) => String(x ?? "").trim()).filter(Boolean);
  const order_by = (Array.isArray(o.order_by) ? o.order_by : [])
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({
      column: String(x.column ?? "").trim(),
      direction: String(x.direction ?? "desc").toLowerCase() === "asc" ? ("asc" as const) : ("desc" as const),
    }))
    .filter((x) => x.column);

  const limit = Number(o.limit);
  const aggRaw = o.aggregate as Record<string, unknown> | null | undefined;
  const aggregate =
    aggRaw && aggRaw.fn && aggRaw.column
      ? {
          fn: String(aggRaw.fn) as QueryIrAggregate["fn"],
          column: String(aggRaw.column),
          alias: aggRaw.alias ? String(aggRaw.alias) : undefined,
        }
      : null;

  return {
    from_tables,
    joins: joins.length ? joins : undefined,
    select: select.length ? select : undefined,
    filters: parseFilters(o.filters),
    or_groups: (Array.isArray(o.or_groups) ? o.or_groups : [])
      .map((g) => parseFilters(g))
      .filter((g) => g.length),
    aggregate,
    group_by: (Array.isArray(o.group_by) ? o.group_by : []).map((x) => String(x ?? "").trim()).filter(Boolean),
    having: parseFilters(o.having),
    order_by: order_by.length ? order_by : undefined,
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : undefined,
  };
}

export function queryIrFromLlmJson(text: string): QueryIr | null {
  const s = String(text ?? "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return parseQueryIr(JSON.parse(s.slice(start, end + 1)));
  } catch {
    return null;
  }
}

export function compileQueryIrToSql(ir: QueryIr): { ok: true; sql: string } | { ok: false; reason: string } {
  const main = ir.from_tables[0]!;
  const parts: string[] = [];

  if (ir.aggregate) {
    const fn = ir.aggregate.fn.toUpperCase();
    const col = ir.aggregate.column === "*" ? "*" : quoteId(ir.aggregate.column);
    const alias = ir.aggregate.alias ? ` AS ${quoteId(ir.aggregate.alias)}` : "";
    parts.push(`SELECT ${fn}(${col})${alias}`);
  } else if (ir.select?.length) {
    parts.push(`SELECT ${ir.select.map(quoteId).join(", ")}`);
  } else {
    parts.push(`SELECT *`);
  }

  parts.push(`FROM ${quoteId(main)}`);

  for (let i = 1; i < ir.from_tables.length; i++) {
    const table = ir.from_tables[i]!;
    const j = ir.joins?.[i - 1];
    const joinType = j?.type === "left" ? "LEFT JOIN" : "INNER JOIN";
    const on = String(j?.on ?? "").trim();
    if (on) parts.push(`${joinType} ${quoteId(table)} ON ${on}`);
    else parts.push(`${joinType} ${quoteId(table)} ON 1=0`);
  }

  const whereParts: string[] = [];
  for (const f of ir.filters ?? []) {
    const w = compileFilter(f);
    if (w) whereParts.push(w);
  }
  for (const group of ir.or_groups ?? []) {
    const ors = group.map(compileFilter).filter(Boolean) as string[];
    if (ors.length) whereParts.push(`(${ors.join(" OR ")})`);
  }
  if (whereParts.length) parts.push(`WHERE ${whereParts.join(" AND ")}`);

  if (ir.group_by?.length) parts.push(`GROUP BY ${ir.group_by.map(quoteId).join(", ")}`);

  const havingParts = (ir.having ?? []).map(compileFilter).filter(Boolean) as string[];
  if (havingParts.length) parts.push(`HAVING ${havingParts.join(" AND ")}`);

  if (ir.order_by?.length) {
    const ob = ir.order_by.map((o) => `${quoteId(o.column)} ${o.direction.toUpperCase()}`).join(", ");
    parts.push(`ORDER BY ${ob}`);
  }

  const limit = ir.limit ?? 20;
  parts.push(`LIMIT ${limit}`);

  const sql = parts.join(" ");
  if (!/\bfrom\b/i.test(sql)) return { ok: false, reason: "missing_from" };
  return { ok: true, sql };
}

export function formatQueryIrForSqlPrompt(ir: QueryIr | null): string {
  if (!ir) return "";
  return JSON.stringify(ir, null, 0);
}

/** 查询计划是否暗示多条件（L2+） */
export function planSuggestsMultiCondition(plan?: QueryPlan | null): boolean {
  if (!plan) return false;
  const whereCount = plan.filters?.where?.length ?? 0;
  if (whereCount >= 2) return true;
  if (plan.intent === "aggregation" || plan.intent === "comparison") return true;
  const entityCount =
    (plan.entities?.names?.length ?? 0) +
    (plan.entities?.locations?.length ?? 0) +
    (plan.filters?.time_range?.relative ? 1 : 0);
  return whereCount >= 1 && entityCount >= 2;
}
