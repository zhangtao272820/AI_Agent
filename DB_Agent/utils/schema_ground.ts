/**
 * Schema 自举：在 plan 之后内部探表，不依赖总管 probe 或跨库切换。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { DataSource } from "typeorm";
import { introspectSchemaWithComments } from "./schema";
import { clipText } from "./nlu/text";
import type { QueryPlan } from "./nlu/query_plan";
import type { ManagerDbTaskContext } from "./manager_task_context";
import {
  discoverSchemaRelations,
  formatSchemaRelationsForAgent,
  reorderFootPressureCandidates,
  tableNameLooksLikeFootPressure,
  type SchemaRelation,
} from "./schema_relations";
import { stripPersonNamesFromSearchText } from "./schema_table_rank";
import {
  applyMasterDetailJudgeFromSchema,
  applyPersonBasicPrimaryTableConstraint,
  formatSchemaJudgeHint,
  judgeTablesForQuestion,
  reorderTablesByJudge,
  tryStructuralFootTableJudge,
  type SchemaTableJudgeResult,
  type TableBrief,
} from "./schema_table_judge";
import { isAuthoritativeLlmTableJudge, stampLlmTableJudge } from "./prefetch_table_judge";
import { getDbAgentBlueprintEnv } from "./db_agent_env";
import { getMustTablesForDataDomain, loadDomainPatch } from "./domain_patch";
import { refinePlanBeforeSchemaGround } from "./schema_domain_align";
import { collectDetailFastPathIntentTokens, reorderTablesByCommentAlignment } from "./detail_fastpath_align";
import { expandMetasForJsonArrayJoins, loadTableColumnMeta } from "./nlu/dbSchemaLinkLlm";

export type SchemaGroundResult = {
  candidate_tables: string[];
  schema_summary: string;
  search_keywords: string;
  relations?: SchemaRelation[];
  relations_text?: string;
  table_judge?: SchemaTableJudgeResult;
  table_judge_hint?: string;
};

export { isAuthoritativeLlmTableJudge, isFakePrefetchTableJudge } from "./prefetch_table_judge";

export function parseSearchTableNames(searchResult: unknown): string[] {
  const text = typeof searchResult === "string" ? searchResult : "";
  if (!text.trim()) return [];
  return text
    .split("\n")
    .filter((l) => /^\s*-\s+/.test(l))
    .map((l) => l.replace(/^\s*-\s+/, "").split(/\s+/)[0]?.trim() || "")
    .filter(Boolean);
}

function parseSearchTableComments(searchResult: unknown): Record<string, string> {
  const text = typeof searchResult === "string" ? searchResult : "";
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*-\s+(\S+)(?:\s+\/\/\s*(.+))?/);
    if (m?.[1]) out[m[1]] = String(m[2] ?? "").trim();
  }
  return out;
}

function compactSchemaHint(schemaText: string, maxColumns = 12, preferTokens: string[] = []): string {
  const text = String(schemaText ?? "").trim();
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const tableLines: string[] = [];
  const colLines: { compact: string; score: number }[] = [];
  const tokens = preferTokens.map((t) => String(t ?? "").trim()).filter((t) => t.length >= 2);

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("Table:")) {
      tableLines.push(t);
      continue;
    }
    if (/^-/.test(t) || /^\s*-\s+/.test(line)) {
      const compact = line
        .replace(/\([^)]*\)/g, "")
        .replace(/\s+(NOT NULL|NULL|PRI|UNI|MUL)\b/g, "")
        .replace(/\s+DEFAULT\s+[^\s]+/g, "")
        .replace(/\s{2,}/g, " ")
        .trimEnd();
      let score = 0;
      const blob = compact.toLowerCase();
      for (const tok of tokens) {
        if (blob.includes(tok.toLowerCase()) || compact.includes(tok)) score += 4;
      }
      colLines.push({ compact, score });
    }
  }

  // 优先输出与 plan 维度/过滤对齐的列，再按原序补齐
  const preferred = colLines.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  const rest = colLines.filter((c) => c.score <= 0);
  const ordered = [...preferred, ...rest];
  const out = [...tableLines, ...ordered.slice(0, maxColumns).map((c) => c.compact)];
  if (colLines.length > maxColumns) {
    out.push(`  - ...（另有 ${colLines.length - maxColumns} 列，编写 SQL 时须 SELECT 全部非敏感业务列）`);
  }
  return out.join("\n").trim();
}

/** 系统/账号类表弱提示（写入 brief 供模型判断，非硬禁止） */
function tableAuthishHint(tableName: string, tableComment: string): string {
  const n = String(tableName ?? "").toLowerCase();
  const c = String(tableComment ?? "");
  const nameHit =
    n.startsWith("sys_") ||
    n.includes("login") ||
    n.includes("oauth") ||
    n.includes("rbac") ||
    /(^|_)user(_|$)/.test(n) ||
    n.includes("account") ||
    n.includes("session");
  const commentHit = ["登录", "账号", "密码", "权限", "认证", "会话"].some((k) => c.includes(k));
  if (!nameHit && !commentHit) return "";
  return "（元数据画像：疑似系统账号/权限/登录类表；人口统计、业务档案类问题通常不宜作主查表，除非问题明确指向账号体系）";
}

/** 设备/物联网/卡片通道类表弱提示：具名人员档案属性不宜抢主表 */
function tableDeviceChannelHint(tableName: string, tableComment: string): string {
  const n = String(tableName ?? "").toLowerCase();
  const c = String(tableComment ?? "");
  const nameHit =
    n.includes("device") ||
    n.includes("iot") ||
    n.includes("gear") ||
    n.includes("crutch") ||
    n.startsWith("iccm_") ||
    n.includes("card_phone");
  const commentHit = ["设备", "物联网", "手环", "拐杖", "仪器", "传感器", "卡片"].some((k) => c.includes(k));
  if (!nameHit && !commentHit) return "";
  return "（元数据画像：疑似设备/物联网/通道类表；按姓名查人员档案属性（手机号等）时通常不宜作主查表，除非问题明确指向设备本身）";
}

function planAlignTokens(plan?: QueryPlan | null): string[] {
  if (!plan) return [];
  const parts = [
    ...(plan.dimensions ?? []),
    ...(plan.metrics ?? []),
    ...(plan.filters?.where ?? []),
    ...(plan.entities?.locations ?? []),
  ];
  for (const s of plan.filters?.slots ?? []) {
    if (s.field_hint) parts.push(s.field_hint);
    const v = String(s.sql_match_value || s.value || "").trim();
    if (v) parts.push(v);
  }
  return Array.from(new Set(parts.map((x) => String(x ?? "").trim()).filter((x) => x.length >= 2))).slice(
    0,
    16,
  );
}

function buildSearchKeywords(
  question: string,
  plan?: QueryPlan | null,
  mgr?: ManagerDbTaskContext | null,
): string {
  const names = plan?.entities?.names ?? [];
  const nameFree = stripPersonNamesFromSearchText(question, names);
  const parts: string[] = [nameFree || question];
  const mgrKw = mgr?.schema_search_keywords?.trim();
  if (mgrKw && mgr?.prefetch_reuse === true) parts.push(mgrKw);
  const patchKw = loadDomainPatch().blueprint.schemaSearchKeywords ?? [];
  if (patchKw.length) parts.push(...patchKw.slice(0, 8));
  if (mgr?.prefetch_reuse === true && mgr?.hint_tables?.length) parts.push(...mgr.hint_tables);
  const boost = loadDomainPatch().schemaOverrides.search_boost_tables ?? [];
  const intentTokens = plan ? collectDetailFastPathIntentTokens(question, plan) : [];
  const hasNamedEntity = (plan?.entities?.names?.length ?? 0) > 0;
  // 有姓名实体时仍注入人员主表 boost，避免「手机号」等 metric 把检索锁到 iccm/device 表而丢档案主表
  const skipPersonBoost =
    !hasNamedEntity &&
    (intentTokens.length > 0 ||
      (plan?.metrics?.length ?? 0) > 0 ||
      plan?.intent === "aggregation" ||
      plan?.intent === "trend" ||
      plan?.intent === "comparison");
  if (boost.length && !skipPersonBoost) parts.push(...boost);
  if (hasNamedEntity || plan?.subject === "person" || plan?.data_domain === "person_basic") {
    const must = getMustTablesForDataDomain(
      plan?.data_domain === "person_health" ? "person_health" : "person_basic",
    );
    if (must.length) parts.push(...must.slice(0, 4));
  }
  if (plan?.entities?.locations?.length) parts.push(...plan.entities.locations);
  if (plan?.metrics?.length) parts.push(...plan.metrics.slice(0, 6));
  if (plan?.dimensions?.length) parts.push(...plan.dimensions.slice(0, 6));
  if (plan?.filters?.where?.length) parts.push(...plan.filters.where.slice(0, 6));
  if (plan?.filters?.slots?.length) {
    for (const s of plan.filters.slots.slice(0, 6)) {
      if (s.field_hint?.trim()) parts.push(s.field_hint.trim());
      const v = String(s.sql_match_value || s.value || "").trim();
      if (v) parts.push(v);
    }
  }
  return clipText(parts.filter(Boolean).join(" "), 450);
}

async function searchTables(ds: DataSource, keywords: string): Promise<{ tables: string[]; comments: Record<string, string> }> {
  const searchResult = await introspectSchemaWithComments(ds, `search:${keywords}`);
  return {
    tables: parseSearchTableNames(searchResult),
    comments: parseSearchTableComments(searchResult),
  };
}

async function loadTableBriefs(
  ds: DataSource,
  tables: string[],
  comments: Record<string, string>,
  maxCols: number,
  plan?: QueryPlan | null,
): Promise<TableBrief[]> {
  const prefer = planAlignTokens(plan);
  const out: TableBrief[] = [];
  for (const name of tables.slice(0, 8)) {
    let columnsSummary = "";
    const comment = comments[name] || "";
    try {
      const schemaText = await introspectSchemaWithComments(ds, `schema:${name}`);
      columnsSummary = compactSchemaHint(String(schemaText || ""), maxCols, prefer);
    } catch {
      columnsSummary = "";
    }
    const metaHints = [tableAuthishHint(name, comment), tableDeviceChannelHint(name, comment)]
      .filter(Boolean)
      .join("");
    out.push({
      name,
      comment: metaHints ? `${comment}${comment ? " " : ""}${metaHints}` : comment,
      columnsSummary,
    });
  }
  return out;
}

export async function runSchemaGround(
  ds: DataSource,
  opts: {
    question: string;
    queryPlan?: QueryPlan | null;
    managerTask?: ManagerDbTaskContext | null;
    maxTables?: number;
    charsPerTable?: number;
    judgeModel?: BaseLanguageModel | null;
  },
): Promise<SchemaGroundResult> {
  const blueprintEnv = getDbAgentBlueprintEnv();
  const maxTables = Math.max(1, Math.min(6, opts.maxTables ?? 4));
  const charsPerTable = opts.charsPerTable ?? 420;
  const queryPlan = opts.queryPlan ? refinePlanBeforeSchemaGround(opts.queryPlan) : opts.queryPlan;
  const isDetail = queryPlan?.intent === "detail";
  const prefetchReuse = Boolean(opts.managerTask?.prefetch_reuse);
  const seedHintTables = (opts.managerTask?.hint_tables ?? [])
    .map((t) => String(t ?? "").trim())
    .filter(Boolean);
  const prefetchedGround = (() => {
    const raw = String(opts.managerTask?.prefetch_schema_ground_json ?? "").trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SchemaGroundResult;
    } catch {
      return null;
    }
  })();
  const authoritativeLlmJudge =
    prefetchReuse && isAuthoritativeLlmTableJudge(prefetchedGround?.table_judge);
  const searchKeywords = buildSearchKeywords(opts.question, queryPlan, opts.managerTask);

  let candidateTables: string[] = [];
  let tableComments: Record<string, string> = {};
  // hint 仅作种子，始终合并 schema 检索结果，禁止用预取列表完全替代探表
  try {
    const first = await searchTables(ds, searchKeywords);
    candidateTables = first.tables;
    tableComments = first.comments;
    if (!candidateTables.length) {
      const names = queryPlan?.entities?.names ?? [];
      const retryKw = stripPersonNamesFromSearchText(opts.question, names);
      if (retryKw && retryKw !== searchKeywords) {
        const second = await searchTables(ds, retryKw);
        candidateTables = second.tables;
        tableComments = second.comments;
      }
    }
  } catch {
    candidateTables = [];
  }
  if (seedHintTables.length) {
    candidateTables = Array.from(new Set([...seedHintTables, ...candidateTables])).slice(
      0,
      Math.max(maxTables, 6),
    );
  }

  candidateTables = candidateTables.slice(0, Math.max(maxTables, 6));
  try {
    const briefMetas = await loadTableColumnMeta(ds, candidateTables.slice(0, 6));
    const expanded = await expandMetasForJsonArrayJoins(ds, briefMetas);
    for (const m of expanded) {
      if (!candidateTables.includes(m.table)) candidateTables.push(m.table);
    }
  } catch {
    /* 补全 JSON 数组关联表失败不影响主流程 */
  }
  candidateTables = reorderFootPressureCandidates(candidateTables, tableComments, queryPlan);
  candidateTables = reorderTablesByCommentAlignment(
    candidateTables,
    tableComments,
    opts.question,
    queryPlan,
  );
  const hasFootTable = candidateTables.some((t) => tableNameLooksLikeFootPressure(t));
  const maxCols = isDetail || hasFootTable ? 40 : 12;

  const domain = queryPlan?.data_domain;
  const namedEntityLookup = (queryPlan?.entities?.names?.length ?? 0) > 0;
  // 具名人员属性查询 / 人员域：强制把域主表放进候选，否则 Judge 无法选到 person_info
  const mustDomain =
    domain && domain !== "general"
      ? domain
      : namedEntityLookup || queryPlan?.subject === "person"
        ? "person_basic"
        : "";
  if (mustDomain) {
    const must = getMustTablesForDataDomain(mustDomain);
    if (must.length) {
      const merged = [...must.filter((t) => !candidateTables.includes(t)), ...candidateTables];
      candidateTables = merged.slice(0, Math.max(maxTables, must.length));
    }
  }

  let tableJudge: SchemaTableJudgeResult | null = null;
  let tableJudgeHint = "";
  let tableBriefs: TableBrief[] = [];
  const skipJudgeLlm =
    authoritativeLlmJudge &&
    candidateTables.length > 0 &&
    candidateTables.length <= 4;
  if (skipJudgeLlm && prefetchedGround?.table_judge) {
    tableJudge = stampLlmTableJudge(prefetchedGround.table_judge);
    candidateTables = reorderTablesByJudge(candidateTables, tableJudge).slice(0, maxTables);
    tableJudgeHint = formatSchemaJudgeHint(tableJudge);
  } else if (blueprintEnv.enableSchemaTableJudge && opts.judgeModel && candidateTables.length > 0) {
    tableBriefs = await loadTableBriefs(ds, candidateTables, tableComments, maxCols, queryPlan);
    tableJudge = tryStructuralFootTableJudge(tableBriefs, queryPlan);
    if (!tableJudge) {
      const judged = await judgeTablesForQuestion(opts.judgeModel, {
        question: opts.question,
        queryPlan,
        tables: tableBriefs,
      });
      if (judged) tableJudge = stampLlmTableJudge(judged);
    }
  } else {
    candidateTables = candidateTables.slice(0, maxTables);
  }

  let relations: SchemaRelation[] = [];
  let relations_text = "";
  try {
    relations = await discoverSchemaRelations(ds, candidateTables);
    relations_text = formatSchemaRelationsForAgent(relations);
  } catch {
    relations = [];
  }

  if (tableJudge && tableBriefs.length) {
    tableJudge = applyMasterDetailJudgeFromSchema(tableJudge, tableBriefs, relations, queryPlan);
    tableJudge = applyPersonBasicPrimaryTableConstraint(tableJudge, tableBriefs, queryPlan);
    candidateTables = reorderTablesByJudge(candidateTables, tableJudge).slice(0, maxTables);
    tableJudgeHint = formatSchemaJudgeHint(tableJudge);
  }

  const parts: string[] = [];
  if (tableJudgeHint) parts.push(tableJudgeHint);
  for (const table of candidateTables.slice(0, maxTables)) {
    try {
      const schemaText = await introspectSchemaWithComments(ds, `schema:${table}`);
      const compact = compactSchemaHint(String(schemaText || ""), maxCols);
      if (compact) parts.push(`表 \`${table}\`\n${clipText(compact, charsPerTable)}`);
    } catch {
      parts.push(`表 \`${table}\`（结构暂不可用）`);
    }
  }

  const schema_summary = parts.length
    ? clipText(`[Schema 接地]\n${parts.join("\n\n")}`, charsPerTable * maxTables + 300)
    : "";

  const fullSummary = [schema_summary, relations_text].filter(Boolean).join("\n\n");

  return {
    candidate_tables: candidateTables,
    schema_summary: fullSummary || schema_summary,
    search_keywords: searchKeywords,
    relations,
    relations_text,
    table_judge: tableJudge ?? undefined,
    table_judge_hint: tableJudgeHint || undefined,
  };
}

export function formatSchemaGroundForAgent(ground: SchemaGroundResult | null | undefined): string {
  if (!ground?.schema_summary?.trim()) return "";
  const tables = (ground.candidate_tables || []).filter(Boolean);
  const head = tables.length ? `候选表：${tables.join("、")}\n` : "";
  return clipText(`${head}${ground.schema_summary.trim()}`, 1700);
}
