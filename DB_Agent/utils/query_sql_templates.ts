/**
 * P5 + P0：成功 SQL 模板沉淀；shadow→confirmed 门控直出。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clipText } from "./nlu/text";
import { normalizeQuestionKey, hasNegativeFeedbackForQuestion } from "./query_learning";
import { getDbAgentBlueprintEnv } from "./db_agent_env";
import type { DataSource } from "typeorm";
import {
  enforceSelectLimit,
  injectMysqlMaxExecutionTimeHint,
  isReadOnlySelectSql,
} from "./sql_safety";
import {
  hashSql,
  isDbSqlHashRevoked,
  setDbTemplateStatus,
  upsertDbQueryTemplateShadow,
} from "#agent-shared/artifactStore";
import { isDbTemplateFeedbackGated } from "#agent-shared/artifactFeedbackPolicy";
import { agentPgQuery, isAgentPgConfigured } from "#agent-shared/agentPgClient";

export type SqlTemplateStatus = "shadow" | "confirmed" | "revoked";

export type SqlTemplate = {
  id: string;
  ts: string;
  question_norm: string;
  data_domain?: string;
  tables: string[];
  sql: string;
  sql_hash?: string;
  hits: number;
  status?: SqlTemplateStatus;
  run_id?: string;
};

function dataDir() {
  const dir = join(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function templatesFile() {
  return join(dataDir(), "db-query-templates.jsonl");
}

function normalizeSql(sql: string): string {
  return String(sql ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function readTemplates(maxLines = 200): SqlTemplate[] {
  const file = templatesFile();
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    const out: SqlTemplate[] = [];
    for (const line of lines.slice(-maxLines)) {
      try {
        out.push(JSON.parse(line) as SqlTemplate);
      } catch {
        continue;
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function readTemplatesFromPg(maxRows = 200): Promise<SqlTemplate[]> {
  if (!isAgentPgConfigured()) return [];
  try {
    const res = await agentPgQuery<{
      id: string;
      ts: string;
      question_norm: string;
      data_domain: string | null;
      tables: unknown;
      sql: string;
      sql_hash: string;
      hits: number;
      status: SqlTemplateStatus;
      run_id: string | null;
    }>(
      `SELECT id, ts, question_norm, data_domain, tables, sql, sql_hash, hits, status, run_id
       FROM db_query_templates
       WHERE status != 'revoked'
       ORDER BY hits DESC, updated_at DESC
       LIMIT $1`,
      [maxRows],
    );
    return (res?.rows ?? []).map((r) => ({
      id: r.id,
      ts: r.ts,
      question_norm: r.question_norm,
      data_domain: r.data_domain ?? undefined,
      tables: Array.isArray(r.tables) ? r.tables.map(String) : [],
      sql: r.sql,
      sql_hash: r.sql_hash,
      hits: r.hits,
      status: r.status,
      run_id: r.run_id ?? undefined,
    }));
  } catch {
    return [];
  }
}

async function readAllTemplates(maxLines = 300): Promise<SqlTemplate[]> {
  const pg = await readTemplatesFromPg(maxLines);
  if (pg.length) return pg;
  return readTemplates(maxLines);
}

function overlapScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const setA = new Set(a.split(""));
  const setB = new Set(b.split(""));
  let inter = 0;
  for (const c of setA) if (setB.has(c)) inter += 1;
  return inter / Math.max(setA.size, setB.size, 1);
}

function templateDirectAllowed(t: SqlTemplate): boolean {
  if (!isDbTemplateFeedbackGated()) return t.status !== "revoked";
  return t.status === "confirmed";
}

export function recordSqlTemplate(input: {
  question: string;
  sql: string;
  data_domain?: string;
  tables?: string[];
  run_id?: string;
}) {
  const sql = String(input.sql ?? "").trim();
  if (!sql || !/^\s*(with\b|select\b)/i.test(sql)) return;
  const question_norm = normalizeQuestionKey(input.question);
  if (!question_norm) return;

  const normSql = normalizeSql(sql);
  const sql_hash = hashSql(sql);
  const all = readTemplates(300);
  const dup = all.find(
    (t) => t.question_norm === question_norm || normalizeSql(t.sql) === normSql || t.sql_hash === sql_hash,
  );
  const status: SqlTemplateStatus = isDbTemplateFeedbackGated() ? "shadow" : "confirmed";

  if (dup) {
    dup.hits += 1;
    dup.ts = new Date().toISOString();
    dup.sql = sql;
    dup.sql_hash = sql_hash;
    if (input.tables?.length) dup.tables = input.tables;
    if (input.run_id) dup.run_id = input.run_id;
    if (!dup.status || dup.status === "shadow") dup.status = status;
    rewriteTemplates(all);
  } else {
    const row: SqlTemplate = {
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      question_norm,
      data_domain: input.data_domain,
      tables: input.tables ?? [],
      sql,
      sql_hash,
      hits: 1,
      status,
      run_id: input.run_id,
    };
    try {
      appendFileSync(templatesFile(), `${JSON.stringify(row)}\n`, "utf8");
    } catch {
      /* ignore */
    }
  }

  void upsertDbQueryTemplateShadow({
    id: dup?.id ?? `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    questionNorm: question_norm,
    sql,
    dataDomain: input.data_domain,
    tables: input.tables,
    runId: input.run_id,
    hits: dup ? dup.hits + 1 : 1,
  }).catch(() => undefined);
}

function rewriteTemplates(rows: SqlTemplate[]) {
  try {
    writeFileSync(
      templatesFile(),
      rows
        .slice(-200)
        .map((r) => JSON.stringify(r))
        .join("\n")
        .concat("\n"),
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

const STRONG_TEMPLATE_SCORE = 0.88;

export async function findStrongSqlTemplateAsync(
  question: string,
  minScore = STRONG_TEMPLATE_SCORE,
): Promise<SqlTemplate | null> {
  const key = normalizeQuestionKey(question);
  if (!key) return null;
  const all = await readAllTemplates(300);
  const scored = all
    .filter(templateDirectAllowed)
    .map((t) => ({ t, s: overlapScore(key, t.question_norm) }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s || b.t.hits - a.t.hits);
  return scored[0]?.t ?? null;
}

export function findStrongSqlTemplate(question: string, minScore = STRONG_TEMPLATE_SCORE): SqlTemplate | null {
  const key = normalizeQuestionKey(question);
  if (!key) return null;
  const scored = readTemplates(300)
    .filter(templateDirectAllowed)
    .map((t) => ({ t, s: overlapScore(key, t.question_norm) }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s || b.t.hits - a.t.hits);
  return scored[0]?.t ?? null;
}

export function recallSimilarSqlTemplates(question: string, limit = 2): SqlTemplate[] {
  const key = normalizeQuestionKey(question);
  if (!key) return [];
  const scored = readTemplates(300)
    .filter((t) => t.status !== "revoked")
    .map((t) => ({ t, s: overlapScore(key, t.question_norm) }))
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s || b.t.hits - a.t.hits);
  const out: SqlTemplate[] = [];
  const seen = new Set<string>();
  for (const { t } of scored) {
    const k = normalizeSql(t.sql);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

export function removeSqlTemplatesForQuestion(question: string): number {
  const question_norm = normalizeQuestionKey(question);
  if (!question_norm) return 0;
  const all = readTemplates(300);
  const kept = all.filter((t) => t.question_norm !== question_norm);
  const removed = all.length - kept.length;
  if (removed > 0) rewriteTemplates(kept);
  void setDbTemplateStatus({ questionNorm: question_norm }, "revoked").catch(() => undefined);
  return removed;
}

export async function trySqlTemplateDirect(
  ds: DataSource,
  question: string,
  minScore?: number,
): Promise<{ sql: string; rows: any[]; templateId: string } | null> {
  const env = getDbAgentBlueprintEnv();
  if (!env.enableSqlTemplateDirect) return null;
  if (hasNegativeFeedbackForQuestion(question)) return null;
  const tpl = (await findStrongSqlTemplateAsync(question, minScore ?? env.sqlTemplateDirectMinScore)) ??
    findStrongSqlTemplate(question, minScore ?? env.sqlTemplateDirectMinScore);
  if (!tpl?.sql) return null;
  const tplHash = tpl.sql_hash ?? hashSql(tpl.sql);
  if (await isDbSqlHashRevoked(tplHash)) return null;
  const checked = isReadOnlySelectSql(tpl.sql);
  if (!checked.ok) return null;
  const limited = enforceSelectLimit(checked.sql, 100, 20);
  const withHint = injectMysqlMaxExecutionTimeHint(limited, 8000);
  try {
    const rows = (await ds.query(withHint)) as any[];
    if (!Array.isArray(rows)) return null;
    tpl.hits += 1;
    rewriteTemplates(readTemplates(300).map((t) => (t.id === tpl.id ? tpl : t)));
    return { sql: withHint, rows, templateId: tpl.id };
  } catch {
    return null;
  }
}

export function formatSqlTemplateBlockForAgent(question: string): string {
  const env = getDbAgentBlueprintEnv();
  const hits = recallSimilarSqlTemplates(question, 1);
  if (!hits.length) return "";
  const lines = ["[SQL模板]（历史成功 SQL 结构参考）"];
  for (const h of hits) {
    const tables = h.tables.length ? `${h.tables.slice(0, 3).join("、")}；` : "";
    lines.push(`- ${tables}${clipText(h.sql, 320)}`);
  }
  return clipText(lines.join("\n"), env.sqlTemplateBlockMaxChars);
}

export function getSqlTemplateSummary() {
  const all = readTemplates(500);
  return { count: all.length, topHits: all.sort((a, b) => b.hits - a.hits).slice(0, 5) };
}

export function dedupeSqlTemplates() {
  const all = readTemplates(500);
  const bySql = new Map<string, SqlTemplate>();
  for (const t of all) {
    const k = normalizeSql(t.sql);
    const prev = bySql.get(k);
    if (!prev || t.hits > prev.hits) bySql.set(k, t);
  }
  const merged = Array.from(bySql.values()).sort((a, b) => b.hits - a.hits);
  rewriteTemplates(merged);
  return { before: all.length, after: merged.length };
}

export function clearSqlTemplates() {
  try {
    writeFileSync(templatesFile(), "", "utf8");
  } catch {
    /* ignore */
  }
}
