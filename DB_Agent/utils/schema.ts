/**
 * 文件用途：数据库 Schema 检索与安全查询工具（供 Agent/工具层使用）。
 *
 * 主要职责：
 * - introspectSchemaWithComments：读取表/字段注释、表结构与样例数据；支持 list/schema/sample/search 等指令。
 * - mysqlSelectSafe：提供只读 SELECT 的安全执行入口，限制危险语句并做字段/条件拼装。
 *
 * 说明：
 * - 该文件的输出主要用于 Agent 推理；如需直接面向用户展示，必须经过输出清洗（避免表名/ID/敏感字段）。
 */
import { DataSource } from "typeorm";
import { getDefaultColumns, resolveColumnAlias } from "./aliases";
import { getDbAgentBlueprintEnv } from "./db_agent_env";

const schemaCache = new Map<string, { ts: number; value: string }>();
const SCHEMA_CACHE_VERSION = "v5";

export function clearSchemaCache() {
  schemaCache.clear();
}

function schemaCacheTtlMs() {
  return getDbAgentBlueprintEnv().schemaCacheTtlSec * 1000;
}
const SCHEMA_CACHE_MAX = 200;

function clipString(v: unknown, maxLen: number) {
  const s = typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
  if (maxLen <= 0) return "";
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

function compactSampleRows(rows: any[], maxKeys = 24, maxStringLen = 120) {
  if (!Array.isArray(rows)) return [];
  const out: any[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") {
      out.push(r);
      continue;
    }
    const keys = Object.keys(r).slice(0, Math.max(1, maxKeys));
    const o: any = {};
    for (const k of keys) {
      const v = (r as any)[k];
      o[k] = typeof v === "string" ? clipString(v, maxStringLen) : v;
    }
    out.push(o);
  }
  return out;
}

import { expandSearchTokens } from "./schema_table_rank";
import { tableCommentLooksLikeExtensionDetail, tableCommentLooksLikeMainRecord } from "./schema_relations";

function extensionSearchRankAdjust(comment: string): number {
  if (tableCommentLooksLikeExtensionDetail(comment)) return -85;
  if (tableCommentLooksLikeMainRecord(comment)) return 35;
  return 0;
}

function normalizeSearchText(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[，,。.;；:："'“”‘’（）()\[\]{}<>《》【】!?？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchText(text: string) {
  const raw = normalizeSearchText(text);
  if (!raw) return [];
  const chunks = raw.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) || [];
  const stop = new Set([
    "查询",
    "统计",
    "信息",
    "情况",
    "有哪些",
    "是什么",
    "多少",
    "几条",
    "条数",
    "数据",
    "记录",
    "详情",
    "明细",
    "列表",
    "请问",
    "帮我",
    "看看",
    "一下",
  ]);
  return Array.from(
    new Set(
      chunks
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .filter((x) => !stop.has(x)),
    ),
  );
}

function textHitScore(haystack: string, needle: string) {
  const h = normalizeSearchText(haystack);
  const n = normalizeSearchText(needle);
  if (!h || !n) return 0;
  if (h === n) return 120;
  if (h.startsWith(n) || n.startsWith(h)) return 70;
  if (h.includes(n)) return Math.min(60, 20 + n.length * 6);
  if (n.length >= 3) {
    let overlap = 0;
    for (let i = 0; i < n.length; i++) {
      const c = n[i];
      if (c && h.includes(c)) overlap += 1;
    }
    if (overlap >= Math.ceil(n.length * 0.7)) return Math.min(24, overlap * 3);
  }
  return 0;
}

function quoteIdent(name: string) {
  const n = String(name ?? "");
  return `\`${n.replace(/`/g, "``")}\``;
}

function safeParseJson(text: string) {
  const t = (text ?? "").trim();
  if (!t) return null;
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

// 轻量 schema 工具：支持 list / schema:表 / sample:表:3 / search:关键词
export async function introspectSchemaWithComments(
  ds: DataSource,
  input: string,
): Promise<string> {
  const modelRoutingOnly = String(process.env.DB_AGENT_MODEL_ROUTING_ONLY || "").toLowerCase() === "true";
  const obj = safeParseJson(input);
  const raw = (input ?? "").trim();
  const lc = raw.toLowerCase();
  const dbName = String((ds.options as any)?.database ?? "");
  const cacheKey = `${SCHEMA_CACHE_VERSION}|${dbName}|${raw}`;
  const now = Date.now();
  const cached = schemaCache.get(cacheKey);
  if (cached && now - cached.ts < schemaCacheTtlMs()) return cached.value;
  const store = (val: string) => {
    schemaCache.set(cacheKey, { ts: now, value: val });
    if (schemaCache.size > SCHEMA_CACHE_MAX) {
      const first = schemaCache.keys().next().value;
      if (first) schemaCache.delete(first);
    }
    return val;
  };

  let action =
    typeof obj?.action === "string" ? String(obj.action).toLowerCase() : "";
  let limit =
    typeof obj?.limit === "number" && Number.isFinite(obj.limit) ? Math.max(1, Math.floor(obj.limit)) : 5;
  const maxColumns =
    typeof (obj as any)?.max_columns === "number" && Number.isFinite((obj as any).max_columns)
      ? Math.max(5, Math.floor((obj as any).max_columns))
      : 40;
  let tablesInput = Array.isArray(obj?.tables) ? obj.tables : null;
  let tableInput =
    typeof obj?.table === "string" && obj.table.trim() ? obj.table.trim() : null;
  let searchInput =
    typeof obj?.search === "string" && obj.search.trim() ? obj.search.trim() : "";

  // 非 JSON 输入的容错解析：list / schema:<t> / sample:<t>:<n> / search:<kw> / 直接关键字
  if (!obj) {
    if (!action) {
      if (lc === "list") action = "list";
      else if (lc.startsWith("schema:")) {
        action = "schema";
        tableInput = raw.slice("schema:".length).trim();
      } else if (lc.startsWith("sample:")) {
        action = "sample";
        const parts = raw.split(":");
        tableInput = (parts[1] || "").trim();
        const n = Number(parts[2] || "0");
        if (Number.isFinite(n) && n > 0) limit = n;
      } else if (lc.startsWith("search:")) {
        action = "search";
        searchInput = raw.slice("search:".length).trim();
      } else {
        action = "search";
        searchInput = raw;
      }
    }
  }

  const tableNames: string[] = [];
  if (tableInput) tableNames.push(tableInput);
  if (tablesInput) {
    for (const t of tablesInput) {
      if (typeof t === "string" && t.trim()) tableNames.push(t.trim());
    }
  }

  if (action === "search") {
    const rawKw = String(searchInput || "").trim();
    const tokens = expandSearchTokens(rawKw);
    const likes = (tokens.length ? tokens : [rawKw]).slice(0, modelRoutingOnly ? 12 : 24);
    const likeConds: string[] = [];
    const likeParams: any[] = [];
    for (const tk of likes) {
      const kw = `%${tk}%`;
      likeConds.push(
        "(t.table_name LIKE ? OR t.table_comment LIKE ? OR c.column_name LIKE ? OR c.column_comment LIKE ?)",
      );
      likeParams.push(kw, kw, kw, kw);
    }

    const where = likeConds.length ? `AND (${likeConds.join(" OR ")})` : "";
    const rawRows = await ds.query(
      `
SELECT
  t.table_name AS table_name,
  COALESCE(t.table_comment, '') AS table_comment,
  c.column_name AS column_name,
  COALESCE(c.column_comment, '') AS column_comment
FROM information_schema.tables t
LEFT JOIN information_schema.columns c
  ON c.table_schema = t.table_schema
 AND c.table_name = t.table_name
WHERE t.table_schema = DATABASE()
${where}
LIMIT 2000
      `,
      likeParams,
    );

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return store(`未找到匹配表：${searchInput}`);
    }

    const rankMap = new Map<
      string,
      { name: string; comment: string; score: number; hits: string[]; matchedColumns: string[] }
    >();
    for (const r of rawRows as any[]) {
      const name = String(r?.table_name || "").trim();
      if (!name) continue;
      const tableComment = String(r?.table_comment || "").trim();
      const colName = String(r?.column_name || "").trim();
      const colComment = String(r?.column_comment || "").trim();
      const rec = rankMap.get(name) || {
        name,
        comment: tableComment,
        score: 0,
        hits: [],
        matchedColumns: [],
      };
      for (const tk of likes) {
        const s1 = textHitScore(name, tk) * 1.6;
        const s2 = textHitScore(tableComment, tk) * 1.2;
        const s3 = colName ? textHitScore(colName, tk) : 0;
        const s4 = colComment ? textHitScore(colComment, tk) * 1.1 : 0;
        const add = Math.max(s1, s2, s3, s4);
        if (add > 0) {
          rec.score += add;
          if (rec.hits.length < 6 && !rec.hits.includes(tk)) rec.hits.push(tk);
          if ((s3 > 0 || s4 > 0) && colName && rec.matchedColumns.length < 8 && !rec.matchedColumns.includes(colName)) {
            rec.matchedColumns.push(colName);
          }
        }
      }
      if (!rec.comment && tableComment) rec.comment = tableComment;
      rankMap.set(name, rec);
    }

    const ranked = Array.from(rankMap.values())
      .filter((x) => x.score > 0)
      .sort(
        (a, b) =>
          b.score +
          extensionSearchRankAdjust(b.comment) -
          (a.score + extensionSearchRankAdjust(a.comment)) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 12);
    if (!ranked.length) return store(`未找到匹配表：${searchInput}`);

    const lines = [`Search tables by "${searchInput}"（semantic-rank）:`];
    for (const item of ranked) {
      const hitInfo = item.hits.length ? ` [hits: ${item.hits.join(", ")}]` : "";
      const colsInfo = item.matchedColumns.length ? ` [cols: ${item.matchedColumns.join(", ")}]` : "";
      lines.push(`- ${item.name}${item.comment ? ` // ${item.comment}` : ""}${hitInfo}${colsInfo}`);
    }
    return store(lines.join("\n"));
  }

  if (action === "list" || tableNames.length === 0) {
    const rows = await ds.query(
      `
SELECT
  table_name AS name,
  table_comment AS comment
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY table_name
LIMIT 80
      `,
    );
    const lines = ["Tables:"];
    for (const r of rows as any[]) {
      lines.push(`- ${r.name}${r.comment ? ` // ${r.comment}` : ""}`);
    }
    return store(lines.join("\n"));
  }

  if (action === "sample") {
    const name = tableNames[0];
    try {
      const safeLimit = Math.max(1, Math.min(5, limit));
      const rows = await ds.query(`SELECT * FROM ${quoteIdent(name)} LIMIT ${safeLimit}`);
      const compact = compactSampleRows(Array.isArray(rows) ? rows : [], 24, 120);
      return store(`SampleRows: ${name}\n${JSON.stringify(compact)}`);
    } catch (e: any) {
      return store(`SampleRows 失败：${e?.message ?? "unknown error"}`);
    }
  }

  const out: string[] = [];
  for (const name of tableNames.slice(0, 10)) {
    const tableRows = await ds.query(
      `
SELECT
  table_name AS name,
  table_comment AS comment
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = ?
LIMIT 1
      `,
      [name],
    );
    const tableComment =
      Array.isArray(tableRows) && tableRows.length > 0 ? (tableRows[0] as any).comment : "";
    out.push(`Table: ${name}${tableComment ? ` // ${tableComment}` : ""}`);
    const colRows = await ds.query(
      `
SELECT
  column_name AS name,
  column_type AS type,
  is_nullable AS nullable,
  column_key AS col_key,
  column_default AS col_default,
  column_comment AS comment
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = ?
ORDER BY ordinal_position
      `,
      [name],
    );
    let colCount = 0;
    for (const c of colRows as any[]) {
      if (colCount >= maxColumns) break;
      colCount += 1;
      const meta = [
        c.nullable === "NO" ? "NOT NULL" : "NULL",
        c.col_key ? String(c.col_key) : "",
        c.col_default !== null && c.col_default !== undefined ? `DEFAULT ${c.col_default}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const comment = c.comment ? clipString(c.comment, 80) : "";
      out.push(`  - ${c.name} (${c.type})${meta ? ` ${meta}` : ""}${comment ? ` // ${comment}` : ""}`);
    }
    if (Array.isArray(colRows) && colRows.length > maxColumns) {
      out.push(`  - ... (${colRows.length - maxColumns} columns omitted)`);
    }
    out.push("");
  }
  return store(out.join("\n"));
}

function kvParse(text: string) {
  const obj: any = {};
  const setp = (o: any, path: string[], v: any) => {
    let cur = o;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (!k) continue;
      if (!cur[k] || typeof cur[k] !== "object") cur[k] = Object.create(null);
      cur = cur[k];
    }
    const key = path[path.length - 1];
    if (key !== undefined) {
      cur[key] = v;
    }
  };
  const parts = String(text || "")
    .split(/[;\n]\s*/g)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const seg of parts) {
    const idx = seg.indexOf("=");
    if (idx === -1) continue;
    const k = seg.slice(0, idx).trim();
    const v = seg.slice(idx + 1).trim();
    if (!k) continue;
    const path = k.split(".").map((s) => s.trim()).filter(Boolean);
    if (!path.length) continue;
    setp(obj, path, v);
  }
  return obj;
}

function isSensitive(name: string) {
  const n = String(name || "").toLowerCase();
  return /(id_card|idcard|身份证|phone|mobile|tel|password|passwd|secret|token)/.test(n);
}

// 只读安全查询：解析 key=value; 输入，做表/列白名单校验，并用参数化 SQL 执行
export async function mysqlSelectSafe(ds: DataSource, input: string) {
  const obj = kvParse(input);
  const table = String(obj.table || "").trim();
  if (!table) return "缺少 table= 参数";
  const t = await ds.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [table],
  );
  if (!Array.isArray(t) || t.length === 0) return `表不存在：${table}`;
  const colsRows: any[] = await ds.query(
    `SELECT column_name AS name, column_comment AS comment FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`,
    [table],
  );
  const allCols = colsRows.map((r) => r.name);
  const colComments: Record<string, string> = {};
  for (const r of colsRows) {
    const n = r?.name;
    if (n) colComments[n] = String(r?.comment || "");
  }
  const resolveCol = (key: string) => {
    const k = String(key || "").trim();
    if (!k) return null;
    const byName = resolveColumnAlias(table, k, allCols);
    if (byName && allCols.includes(byName)) return byName;
    const lk = k.toLowerCase();
    const byComment = allCols.find((c) => String(colComments[c] || "").toLowerCase().includes(lk));
    return byComment || null;
  };
  let columns: string[] = [];
  if (typeof obj.columns === "string" && obj.columns.trim()) {
    columns = obj.columns
      .split(",")
      .map((s: string) => s.trim())
      .map((c: string) => resolveCol(c) || c)
      .filter((c: string) => allCols.includes(c));
  } else {
    const preset = getDefaultColumns(table);
    const presetCols = (preset || []).filter((c) => allCols.includes(c));
    columns = (presetCols.length ? presetCols : allCols).filter((c) => !isSensitive(c)).slice(0, 80);
  }
  if (columns.length === 0) columns = allCols.filter((c) => !isSensitive(c)).slice(0, 40);

  const colByLower: Record<string, string> = {};
  for (const c of allCols) colByLower[String(c || "").toLowerCase()] = c;
  const pickDefaultOrderBy = () => {
    const preferred = [
      "last_receive_time",
      "receive_time",
      "last_report_time",
      "report_time",
      "test_time",
      "measure_time",
      "record_time",
      "health_time",
      "check_time",
      "exam_time",
      "create_time",
      "update_time",
      "time",
      "date",
    ];
    for (const p of preferred) {
      const hit = colByLower[p];
      if (hit) return hit;
    }
    const byComment =
      allCols.find((c) => /(接收|上报|报告|检测|测量|记录|创建|更新时间).*(时间|日期)/.test(String(colComments[c] || ""))) ||
      allCols.find((c) => /(时间|日期)/.test(String(colComments[c] || ""))) ||
      "";
    return byComment || "";
  };

  const whereParts: string[] = [];
  const values: any[] = [];
  if (obj.eq && typeof obj.eq === "object") {
    for (const [k, v] of Object.entries(obj.eq)) {
      const col = resolveCol(String(k));
      if (col && allCols.includes(col)) {
        whereParts.push(`${quoteIdent(col)} = ?`);
        values.push(v);
      }
    }
  }
  if (obj.like && typeof obj.like === "object") {
    for (const [k, v] of Object.entries(obj.like)) {
      const col = resolveCol(String(k));
      if (col && allCols.includes(col) && typeof v === "string" && v.trim()) {
        const raw = v.trim();
        const clipped = raw.length > 80 ? raw.slice(0, 80) : raw;
        whereParts.push(`${quoteIdent(col)} LIKE ?`);
        values.push(`%${clipped}%`);
      }
    }
  }
  const orderBy =
    typeof obj.order_by === "string"
      ? (() => {
          const col = resolveCol(obj.order_by);
          return col && allCols.includes(col) ? col : "";
        })()
      : "";
  const orderDir = String(obj.order_dir || "").toUpperCase() === "ASC" ? "ASC" : "DESC";
  const lim = parseInt(String(obj.limit || "20")) || 20;
  const off = parseInt(String(obj.offset || "0")) || 0;
  const limit = Math.max(1, Math.min(100, lim));
  const offset = Math.max(0, off);
  const effectiveOrderBy = orderBy || pickDefaultOrderBy();
  const sql =
    `SELECT ${columns.map((c) => quoteIdent(c)).join(", ")} FROM ${quoteIdent(table)}` +
    (whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "") +
    (effectiveOrderBy ? ` ORDER BY ${quoteIdent(effectiveOrderBy)} ${orderDir}` : "") +
    ` LIMIT ${limit}` +
    (offset ? ` OFFSET ${offset}` : "");
  const rows = await ds.query(sql, values);
  return JSON.stringify({ rows });
}
