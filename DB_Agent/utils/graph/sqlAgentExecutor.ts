/**
 * SQL Agent ReAct 执行器（从 conversational_retrieval_chain 抽出，D-P0-2 收尾）。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { DataSource } from "typeorm";
import { getAgent } from "../agent";
import { DB_AGENT_DEFAULTS, getDbAgentBlueprintEnv } from "../db_agent_env";
import { clipText, extractNameCandidatesFromQuestion, formatQueryPlanForSqlAgent, mergeWithBudget, parseQueryPlan } from "../nlu";
import { introspectSchemaWithComments } from "../schema";
import {
  applyMasterDetailJudgeFromSchema,
  judgeTablesForQuestion,
  reorderTablesByJudge,
} from "../schema_table_judge";
import { discoverSchemaRelations } from "../schema_relations";
import { isCountQueryFromPlan, planRequestsContactReveal } from "../nlu/dbAnswerFormat";
import { inferExecutionShapeStructural } from "../nlu/dbQueryExecutionShapeLlm";
import { resolveDbModelForStage } from "../nlu/dbModelRouter";
import {
  friendlyFallbackMessage,
  getAgentSqlQueryStats,
  extractLastSqlRows,
  isLikelyPersonNameColumn,
  rowMatchesAnyNameHint,
  sqlTextContainsAllNameHints,
} from "../support";
import { humanizeAssistantText, sanitizeAssistantText, sanitizeAssistantTextForPlan, formatValueAnswer, wrapConversationalDataReply } from "../text";
import { extractPersonName } from "../tools";
import { formatFieldValueForUser } from "../display_values";
import { incrementLlmCallCount } from "../llm_call_counter";
import { buildExploratoryDataContext } from "../explore_context";
import { getSqlBlueprintTemplateHints } from "../sql_blueprint_hints";
import { sqlLikelyMissingExtractedNames } from "../sql_business_guard";
import { formatSqlPreflightForSqlAgent, safeParseSqlPreflightJson } from "../sql_preflight";
import {
  formatManagerContextBlob,
  formatManagerTaskBlockForAgent,
  shouldSuppressDbExperienceReplay,
} from "../manager_task_context";
import { formatSchemaGroundForAgent } from "../schema_ground";
import { formatExperienceBlockForAgent } from "../query_learning";
import { getPromptPatchesForStage } from "../prompt_evolution";
import { formatUserPreferencesBlock } from "../user_preferences";
import { recordQueryMetric } from "../query_metrics";
import type { SkillRunContext } from "../skills";
import type { DbGraphRuntimeConfig } from "./types";

export type SqlAgentExecutorDeps = {
  ds: DataSource;
  model: BaseLanguageModel;
  largerModel?: BaseLanguageModel;
  nluModel?: BaseLanguageModel;
  progress?: (text: string) => void;
  config: DbGraphRuntimeConfig;
  embeddingConfig: {
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    embeddingModel?: string;
    embeddingDimensions: number;
  };
};

export function createSqlAgentExecutor(deps: SqlAgentExecutorDeps) {
  const { ds, model, largerModel, progress, config, embeddingConfig } = deps;

  const looksLikeSqlInput = (q: string) => {
    const t = String(q ?? "").trim();
    if (!t) return false;
    if (!/^(select|with)\b/i.test(t)) return false;
    return /\bfrom\b/i.test(t) || /\bselect\b/i.test(t);
  };

  const isReadOnlySelectSql = (sql: string) => {
    const raw = String(sql ?? "").trim();
    if (!raw) return { ok: false as const, reason: "empty" as const };
    const normalized = raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ")
      .replace(/#[^\n]*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const s = normalized.replace(/;+\s*$/g, "").trim();
    if (!s) return { ok: false as const, reason: "empty" as const };
    if (/[;][^]*[^\s]/.test(s)) return { ok: false as const, reason: "multi_statement" as const };
    if (!/^(select|with)\b/i.test(s)) return { ok: false as const, reason: "not_select" as const };
    if (/\b(insert|update|delete|drop|alter|create|truncate|replace|grant|revoke|call|load)\b/i.test(s)) {
      return { ok: false as const, reason: "write_keyword" as const };
    }
    if (/\binto\s+(outfile|dumpfile)\b/i.test(s) || /\bload_file\s*\(/i.test(s)) {
      return { ok: false as const, reason: "file_io" as const };
    }
    if (/\b(sleep|benchmark)\s*\(/i.test(s)) return { ok: false as const, reason: "time_bomb" as const };
    if (/\b(information_schema|performance_schema|sys)\b/i.test(s) || /\bmysql\s*\./i.test(s)) {
      return { ok: false as const, reason: "system_schema" as const };
    }
    return { ok: true as const, sql: s };
  };

  const enforceSelectLimit = (sql: string, maxLimit: number, defaultLimit: number) => {
    const s = String(sql ?? "").trim().replace(/;+\s*$/g, "").trim();
    if (!s) return s;
    const hasLimit = /\blimit\b/i.test(s);
    if (!hasLimit) return `${s} LIMIT ${defaultLimit}`;
    return s.replace(
      /\blimit\s+(\d+)(\s*,\s*(\d+))?/i,
      (_m, a, commaPart, b) => {
        const n1 = Number(a);
        const n2 = b ? Number(b) : NaN;
        if (commaPart && Number.isFinite(n1) && Number.isFinite(n2)) {
          const safeN2 = Math.max(1, Math.min(maxLimit, Math.floor(n2)));
          return `LIMIT ${Math.max(0, Math.floor(n1))}, ${safeN2}`;
        }
        if (Number.isFinite(n1)) {
          const safe = Math.max(1, Math.min(maxLimit, Math.floor(n1)));
          return `LIMIT ${safe}`;
        }
        return `LIMIT ${Math.max(1, Math.min(maxLimit, defaultLimit))}`;
      },
    );
  };

  const injectMysqlMaxExecutionTimeHint = (sql: string, ms: number) => {
    const s = String(sql ?? "").trim();
    if (!s) return s;
    const already = /max_execution_time\s*\(/i.test(s) || /MAX_EXECUTION_TIME\s*\(/i.test(s);
    if (already) return s;
    const hint = `/*+ MAX_EXECUTION_TIME(${Math.max(1, Math.floor(ms))}) */`;
    return s.replace(/\bselect\b/i, (m) => `${m} ${hint}`);
  };

  const parseExplainInsights = (tabularRows: any[]) => {
    const insights: string[] = [];
    if (!Array.isArray(tabularRows) || tabularRows.length === 0) return insights;
    for (const r of tabularRows as any[]) {
      const type = String(r?.type ?? r?.access_type ?? "").toUpperCase();
      const key = String(r?.key ?? r?.key_name ?? "");
      const rows = Number(r?.rows ?? NaN);
      const extra = String(r?.Extra ?? r?.extra ?? "");
      if (type === "ALL" && !key) insights.push("出现全表扫描，优先考虑为过滤条件/关联条件添加索引");
      if (extra && /Using temporary/i.test(extra)) insights.push("执行过程中可能产生临时表，建议减少不必要的分组/排序或为相关列建索引");
      if (extra && /Using filesort/i.test(extra)) insights.push("出现文件排序（Using filesort），建议为排序列建索引或减少排序数据量");
      if (Number.isFinite(rows) && rows >= 50_000) insights.push("预计扫描行数较大，建议收紧 WHERE 条件或优化索引");
    }
    return Array.from(new Set(insights)).slice(0, 4);
  };

  const extractFirstTableName = (sql: string) => {
    const s = String(sql ?? "");
    const m =
      s.match(/\bfrom\s+`([^`]+)`/i) ||
      s.match(/\bfrom\s+([a-z0-9_]+)\b/i) ||
      s.match(/\bjoin\s+`([^`]+)`/i) ||
      s.match(/\bjoin\s+([a-z0-9_]+)\b/i);
    const name = (m?.[1] ?? "").trim();
    return name || null;
  };

  const stripSqlStringLiterals = (sql: string) => {
    const s = String(sql ?? "");
    let out = "";
    let i = 0;
    while (i < s.length) {
      const ch = s[i]!;
      if (ch === "'" || ch === '"') {
        const quote = ch;
        out += quote;
        i += 1;
        while (i < s.length) {
          const c = s[i]!;
          if (c === "\\" && i + 1 < s.length) {
            out += " ";
            i += 2;
            continue;
          }
          if (c === quote) {
            out += quote;
            i += 1;
            break;
          }
          out += " ";
          i += 1;
        }
        continue;
      }
      out += ch;
      i += 1;
    }
    return out;
  };

  const levenshtein = (a: string, b: string) => {
    const s = String(a ?? "");
    const t = String(b ?? "");
    const n = s.length;
    const m = t.length;
    if (n === 0) return m;
    if (m === 0) return n;
    const prev = new Array<number>(m + 1);
    const cur = new Array<number>(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      const si = s.charCodeAt(i - 1);
      for (let j = 1; j <= m; j++) {
        const tj = t[j - 1];
        const cost = tj !== undefined && si === tj.charCodeAt(0) ? 0 : 1;
        cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      }
      for (let j = 0; j <= m; j++) prev[j] = cur[j]!;
    }
    return prev[m]!;
  };

  const suggestClosestColumn = async (table: string, unknownCol: string) => {
    const t = String(table ?? "").trim();
    const raw = String(unknownCol ?? "").trim();
    const col = raw.includes(".") ? raw.split(".").pop() || raw : raw;
    const needle = col.replace(/[`"'“”]/g, "").trim();
    if (!t || !needle) return null;
    try {
      const rows = await ds.query(
        "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
        [t],
      );
      const cols = Array.isArray(rows) ? (rows as any[]).map((r) => String(r?.name ?? "")).filter(Boolean) : [];
      if (!cols.length) return null;
      const nLower = needle.toLowerCase();
      const scored = cols
        .map((c) => {
          const cLower = c.toLowerCase();
          let score = 0;
          if (cLower === nLower) score += 100;
          if (cLower.replace(/_/g, "") === nLower.replace(/_/g, "")) score += 80;
          if (cLower.startsWith(nLower) || nLower.startsWith(cLower)) score += 30;
          if (cLower.includes(nLower) || nLower.includes(cLower)) score += 20;
          const d = levenshtein(cLower, nLower);
          score += Math.max(0, 20 - d * 4);
          return { c, score, d };
        })
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (!best) return null;
      if (best.score >= 70) return best.c;
      if (best.d <= 2) return best.c;
      return null;
    } catch {
      return null;
    }
  };

  const buildSqlOptimizationTips = (sql: string, extraInsights: string[] = []) => {
    const tips: string[] = [];
    const s = String(sql ?? "");
    if (/\bselect\s+\*\b/i.test(s)) tips.push("只选择需要的字段，避免 SELECT *");
    if (!/\bwhere\b/i.test(s) && /\bfrom\b/i.test(s)) tips.push("尽量增加 WHERE 条件，避免扫描过多数据");
    if (/\border\s+by\b/i.test(s) && !/\blimit\b/i.test(s)) tips.push("存在 ORDER BY 但没有 LIMIT，建议限制返回行数减少排序开销");
    if (/\bin\s*\(\s*select\b/i.test(s)) tips.push("子查询 IN (SELECT ...) 可考虑改写为 JOIN/EXISTS 以提升性能与可读性");
    if (/\bexists\s*\(\s*select\b/i.test(s) && /\bselect\s+\*/i.test(s)) tips.push("EXISTS 子查询里尽量改为 SELECT 1，减少无用列");
    for (const x of extraInsights) tips.push(x);
    return Array.from(new Set(tips)).slice(0, 6);
  };

  const shouldAttachPerfBlock = (q: string, meta: any) => {
    const t = String(q ?? "").replace(/\s+/g, "");
    if (/(优化|性能|慢|卡|索引|执行计划|explain|改写|重写|多方案)/i.test(t)) return true;
    const ms = Number(meta?.execution_ms ?? NaN);
    if (Number.isFinite(ms) && ms >= 1200) return true;
    if (Array.isArray(meta?.warnings) && meta.warnings.length) return true;
    return false;
  };

  const parseSearchTableNames = (searchResult: unknown) => {
    const text = typeof searchResult === "string" ? searchResult : "";
    if (!text.trim()) return [];
    return text
      .split("\n")
      .filter((l) => /^\s*-\s+/.test(l))
      .map((l) => l.replace(/^\s*-\s+/, "").split(/\s+/)[0]?.trim() || "")
      .filter(Boolean);
  };

  const compactSchemaHint = (schemaText: string, maxColumns = 14) => {
    const text = String(schemaText ?? "").trim();
    if (!text) return "";
    const lines = text.split(/\r?\n/);
    const out: string[] = [];
    let colCount = 0;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("Table:")) {
        out.push(t);
        continue;
      }
      if (/^-/.test(t) || /^\s*-\s+/.test(line)) {
        if (colCount >= maxColumns) continue;
        colCount += 1;
        const compact = line
          .replace(/\([^)]*\)/g, "")
          .replace(/\s+(NOT NULL|NULL|PRI|UNI|MUL)\b/g, "")
          .replace(/\s+DEFAULT\s+[^\s]+/g, "")
          .replace(/\s{2,}/g, " ")
          .trimEnd();
        out.push(compact);
      }
    }
    return out.join("\n").trim();
  };

  const agentExecutor = async (question: string, ctx?: SkillRunContext) => {
    const blueprintEnv = getDbAgentBlueprintEnv();
    const schemaHint = String(ctx?.schemaSearchHint || "").trim();
    const questionHead =
      String(question ?? "").split("\n\n[技能]\n")[0]?.trim() || String(question ?? "").trim();
    // 必须与完整问句合并：schema_search_keywords 常不含姓名，若单独用作 userCue 会导致人名提取/行过滤/SQL 选步全部失真
    const userCue = clipText([questionHead, schemaHint].filter(Boolean).join("\n"), blueprintEnv.maxModelInputChars);

    try {
      const headForSql = questionHead;
      if (looksLikeSqlInput(headForSql)) {
        const checked = isReadOnlySelectSql(headForSql);
        if (!checked.ok) {
          const msg =
            checked.reason === "not_select" || checked.reason === "write_keyword"
              ? "只允许执行只读 SELECT 查询。"
              : checked.reason === "multi_statement"
                ? "检测到多条语句，已拒绝执行。"
                : checked.reason === "system_schema"
                  ? "系统库/系统表访问已禁用。"
                  : "SQL 不合法，已拒绝执行。";
          return msg;
        }
        const safeMaxLimit = 100;
        const safeDefaultLimit = 20;
        const limited = enforceSelectLimit(checked.sql, safeMaxLimit, safeDefaultLimit);
        const withHint = injectMysqlMaxExecutionTimeHint(limited, 6000);
        progress?.("正在执行 SQL 查询...");
        const started = Date.now();
        let rows: any[] = [];
        let errorText = "";
        try {
          rows = (await ds.query(withHint)) as any[];
        } catch (e: any) {
          errorText = typeof e?.message === "string" ? e.message : String(e);
        }
        const ms = Math.max(0, Date.now() - started);
        if (errorText) {
          try {
            if (/deadlock/i.test(errorText)) {
              rows = (await ds.query(withHint)) as any[];
              errorText = "";
            }
          } catch {}
          if (errorText) {
            const mUnknownCol = String(errorText).match(/Unknown column '([^']+)'/i);
            const unknown = mUnknownCol?.[1] ?? "";
            const table = extractFirstTableName(checked.sql);
            if (unknown && table) {
              const suggestion = await suggestClosestColumn(table, unknown);
              if (suggestion && suggestion !== unknown) {
                const safeSql = stripSqlStringLiterals(withHint);
                const escaped = unknown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const re = new RegExp(`\\b${escaped}\\b`, "g");
                if (re.test(safeSql)) {
                  try {
                    const fixed = withHint.replace(re, suggestion);
                    rows = (await ds.query(fixed)) as any[];
                    errorText = "";
                  } catch (e2: any) {
                    const msg2 = typeof e2?.message === "string" ? e2.message : String(e2);
                    return sanitizeAssistantText(`查询失败：已尝试自动更正列名（${unknown} → ${suggestion}），但仍执行失败：${msg2}`);
                  }
                }
              }
            }
          }
          if (errorText) return sanitizeAssistantText(`查询失败：${errorText}`);
        }
        const warnings: string[] = [];
        if (/\bselect\s+\*\b/i.test(checked.sql)) warnings.push("检测到 SELECT *，建议只选择需要的字段以减少 IO");
        if (!/\bwhere\b/i.test(checked.sql)) {
          const table = extractFirstTableName(checked.sql);
          if (table) {
            try {
              const tr = await ds.query(
                "SELECT table_rows AS rows FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
                [table],
              );
              const approx = Array.isArray(tr) ? Number((tr as any[])[0]?.rows ?? NaN) : NaN;
              if (Number.isFinite(approx) && approx > 10_000) {
                warnings.push("疑似全表查询且数据量较大，建议增加 WHERE 条件或确保 LIMIT 足够小");
              }
            } catch {}
          }
        }
        if (ms >= 1500) warnings.push("本次查询耗时偏长，建议查看执行计划并考虑索引优化");
        const meta = { execution_ms: ms, row_count: Array.isArray(rows) ? rows.length : 0, warnings: warnings.length ? warnings : undefined };
        const wantsRows =
          /(记录|明细|列表|检测|测量|日志|数据|最近|最新|历史|详情|详细|基本信息|完整|全部字段|全字段|所有字段)/.test(
            headForSql,
          );
        const forceFullByQuestion =
          /(详情|详细|基本信息|完整|全部字段|全字段|所有字段|全部信息|所有信息)/.test(String(headForSql ?? "").replace(/\s+/g, "")) ||
          /(编号|id|ID|code|编码)\s*(为|=|:|：)?\s*[A-Za-z0-9][A-Za-z0-9_-]{2,}/.test(String(headForSql ?? ""));
        const clipVal = (v: any) => {
          if (v === null || v === undefined) return "（空）";
          if (typeof v === "string") return v.length > 400 ? `${v.slice(0, 400)}…` : v;
          if (typeof v === "number" || typeof v === "boolean") return String(v);
          try {
            const j = JSON.stringify(v);
            return j.length > 400 ? `${j.slice(0, 400)}…` : j;
          } catch {
            const s = String(v);
            return s.length > 400 ? `${s.slice(0, 400)}…` : s;
          }
        };
        const isSensitiveKey = (k: string) => {
          if (planRequestsContactReveal(ctx?.queryPlan) && /(phone|mobile|tel)/i.test(k)) return false;
          return /(id_card|idcard|身份证|phone|mobile|tel|password|passwd|secret|token)/i.test(k);
        };
        const isIdKey = (k: string) => {
          const s = String(k || "").trim().toLowerCase();
          if (!s) return true;
          if (s === "id") return true;
          if (s.endsWith("_id")) return true;
          if (s.startsWith("id_")) return true;
          if (s.includes("编号")) return true;
          return false;
        };
        const renderOne = (r: any) => {
          const obj = r && typeof r === "object" ? r : { value: r };
          const keys = Object.keys(obj).filter((k) => !isSensitiveKey(k) && !isIdKey(k));
          const picked = keys.slice(0, forceFullByQuestion ? 120 : 40);
          const lines: string[] = [];
          for (const k of picked) lines.push(`- ${k}：${clipVal((obj as any)[k])}`);
          if (lines.length === 0) lines.push("- 暂无可展示字段");
          return lines;
        };
        const base: string[] = [];
        if (!rows.length) {
          base.push("按当前条件在库里没有匹配到数据；您可以换个时间范围或关键词再试一次。");
        } else if (wantsRows) {
          const limit = (() => {
            const m = String(headForSql ?? "").replace(/\s+/g, "").match(/最近(\d{1,2})次/);
            const n = m?.[1] ? Number(m[1]) : NaN;
            if (Number.isFinite(n) && n > 0) return Math.max(1, Math.min(20, Math.floor(n)));
            if (/(最新|最近)/.test(headForSql) && !/(最近几|最近多次|近\d+次)/.test(headForSql)) return 1;
            return 5;
          })();
          const clipped = rows.slice(0, limit);
          base.push("查询到以下记录：", "");
          for (let i = 0; i < clipped.length; i++) {
            base.push(`记录 ${i + 1}：`);
            base.push(...renderOne(clipped[i]));
            base.push("");
          }
        } else {
          if (rows.length === 1 && rows[0] && typeof rows[0] === "object") {
            const obj = rows[0] as any;
            const keys = Object.keys(obj).filter((k) => !isSensitiveKey(k) && !isIdKey(k));
            const picked = keys.slice(0, forceFullByQuestion ? 80 : 3);
            const parts: string[] = [];
            for (const k of picked) parts.push(`${k}=${clipVal(obj[k])}`);
            if (parts.length) base.push(`汇总结果：${parts.join("，")}。`);
            else base.push("已查询到 1 条结果。");
          } else {
            base.push(`已查询到 ${rows.length} 条结果。`);
          }
        }
        let explainInsights: string[] = [];
        try {
          const plan = await ds.query("EXPLAIN " + withHint.replace(/^\s*(select|with)\b/i, "$1"));
          explainInsights = parseExplainInsights(Array.isArray(plan) ? (plan as any[]) : []);
        } catch {}
        const tips = buildSqlOptimizationTips(checked.sql, explainInsights);
        const out: string[] = [...base];
        if (shouldAttachPerfBlock(headForSql, meta) && tips.length) {
          out.push("", "性能与优化建议：");
          for (const t of tips) out.push(`- ${t}`);
          out.push(`- 本次查询耗时：${meta.execution_ms}ms`);
        }
        return sanitizeAssistantTextForPlan(out.join("\n").trim(), ctx?.queryPlan);
      }

      const planBlock = clipText(formatQueryPlanForSqlAgent(ctx?.queryPlan), blueprintEnv.agentPlanMaxChars);
      const preflightBlock = clipText(
        formatSqlPreflightForSqlAgent(ctx?.sqlPreflight ?? undefined),
        blueprintEnv.agentPreflightMaxChars,
      );
      const managerBlock = clipText(formatManagerTaskBlockForAgent(ctx?.managerTask ?? null), 900);
      const schemaGroundBlock = clipText(formatSchemaGroundForAgent(ctx?.schemaGround ?? null), 1100);
      const experienceBlock =
        DB_AGENT_DEFAULTS.enableQueryLearning && !shouldSuppressDbExperienceReplay(ctx?.managerTask ?? null)
          ? clipText(formatExperienceBlockForAgent(questionHead), 400)
          : "";
      const evolveBlock = DB_AGENT_DEFAULTS.enablePromptEvolution ? clipText(getPromptPatchesForStage("sql"), 480) : "";
      const routeBlock = clipText(String(ctx?.routeHint ?? ""), 420);
      const modelQuestion = [question, planBlock, preflightBlock, managerBlock, schemaGroundBlock, routeBlock, experienceBlock, evolveBlock]
        .filter(Boolean)
        .join("\n\n");
      const searchBoostParts = [
        questionHead,
        schemaHint,
        ...(ctx?.queryPlan?.entities?.names ?? []),
        ...(ctx?.queryPlan?.entities?.locations ?? []),
        ...(ctx?.queryPlan?.entities?.orgs ?? []),
        ...(ctx?.queryPlan?.metrics ?? []).slice(0, 6),
        ...(ctx?.queryPlan?.dimensions ?? []).slice(0, 6),
        ...(ctx?.queryPlan?.filters?.where ?? []).slice(0, 6),
        ...(ctx?.schemaGround?.candidate_tables ?? []),
        ...(ctx?.managerTask?.hint_tables ?? []),
        ...String(ctx?.managerTask?.schema_search_keywords ?? "")
          .split(/\s+/)
          .map((x) => x.trim())
          .filter((x) => x.length >= 2)
          .slice(0, 14),
      ];
      const searchForSchema = clipText(searchBoostParts.filter(Boolean).join(" "), 450) || questionHead;
      const rerankUserQuestion = clipText([questionHead, schemaHint].filter(Boolean).join(" "), 900);

      const agentModelName = String((config as any)?.openaiAgentModel || (config as any)?.openaiModel || "").trim();
      const isWeakModel = (() => {
        const m = agentModelName.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b/);
        if (!m?.[1]) return false;
        const v = Number(m[1]);
        return Number.isFinite(v) ? v <= 14 : false;
      })();

      let searchContext = "";
      let candidateTables: string[] = [];
      const rerankCandidateTablesWithModel = async (q: string, tables: string[], comments: Record<string, string>) => {
        let uniq = Array.from(new Set((tables || []).map((x) => String(x || "").trim()).filter(Boolean)));
        uniq = reorderFootPressureCandidates(uniq, comments, ctx?.queryPlan);
        if (uniq.length <= 1) return { tables: uniq, hint: "" };
        const cachedJudge = ctx?.schemaGround?.table_judge;
        if (cachedJudge) {
          return {
            tables: reorderTablesByJudge(uniq, cachedJudge),
            hint: ctx?.schemaGround?.table_judge_hint || formatSchemaJudgeHint(cachedJudge),
          };
        }
        try {
          const modelRoutingOnly = String(process.env.DB_AGENT_MODEL_ROUTING_ONLY || "").toLowerCase() === "true";
          if (modelRoutingOnly || !DB_AGENT_DEFAULTS.enableSchemaTableJudge) {
            return { tables: uniq, hint: "" };
          }
          const briefs = [];
          for (const table of uniq.slice(0, 5)) {
            let columnsSummary = "";
            try {
              const schemaText = await introspectSchemaWithComments(ds, `schema:${table}`);
              columnsSummary = compactSchemaHint(String(schemaText || ""), 10);
            } catch {
              columnsSummary = "";
            }
            briefs.push({ name: table, comment: comments[table] || "", columnsSummary });
          }
          let judge = tryStructuralFootTableJudge(briefs, ctx?.queryPlan);
          if (!judge) {
            judge = await judgeTablesForQuestion(largerModel ?? model, {
              question: q,
              queryPlan: ctx?.queryPlan,
              tables: briefs,
            });
          }
          if (!judge) return { tables: uniq, hint: "" };
          const relations = await discoverSchemaRelations(ds, briefs.map((b) => b.name));
          judge = applyMasterDetailJudgeFromSchema(judge, briefs, relations, ctx?.queryPlan);
          judge = applyPersonBasicPrimaryTableConstraint(judge, briefs, ctx?.queryPlan);
          return {
            tables: reorderTablesByJudge(uniq, judge),
            hint: formatSchemaJudgeHint(judge),
          };
        } catch {
          return { tables: uniq, hint: "" };
        }
      };
      const ensureSearchContext = async () => {
        if (searchContext || candidateTables.length > 0) return;
        try {
          progress?.("正在从数据库中查找相关信息...");
          const modelRoutingOnly = String(process.env.DB_AGENT_MODEL_ROUTING_ONLY || "").toLowerCase() === "true";
          const searchResult = await introspectSchemaWithComments(ds, `search:${searchForSchema}`);
          const lines =
            typeof searchResult === "string"
              ? searchResult.split("\n").filter((l) => /^\s*-\s+/.test(l))
              : [];
          const parsedTables = parseSearchTableNames(searchResult);
          const tableComments: Record<string, string> = {};
          if (typeof searchResult === "string") {
            for (const line of searchResult.split("\n")) {
              const m = line.match(/^\s*-\s+(\S+)(?:\s+\/\/\s*(.+))?/);
              if (m?.[1]) tableComments[m[1]] = String(m[2] ?? "").trim();
            }
          }
          const judged = modelRoutingOnly
            ? { tables: parsedTables, hint: "" }
            : await rerankCandidateTablesWithModel(rerankUserQuestion, parsedTables, tableComments);
          candidateTables = judged.tables.slice(0, 4);
          progress?.(`已找到 ${parsedTables.length} 个候选表，已完成智能选表`);
          const top = candidateTables.map((t) => `- ${t}`).join("\n");
          if (top) searchContext = `\n\n候选表（智能选表后）：\n${top}\n\n`;
          if (judged.hint) searchContext = (searchContext || "") + `${judged.hint}\n\n`;
        } catch {}
      };

      const shouldPreSearch = (q: string) => {
        const text = String(q ?? "").trim();
        if (!text) return false;
        if (isWeakModel) return true;
        const modelRoutingOnly = String(process.env.DB_AGENT_MODEL_ROUTING_ONLY || "").toLowerCase() === "true";
        if (modelRoutingOnly) return true;
        // 兜底：较长自然语言问题先做一次 schema 检索，降低幻觉表名概率。
        return text.length >= 8;
      };

      const wantsSchemaHint = (q: string) => {
        const t = String(q ?? "").replace(/\s+/g, "");
        return /(字段|列|注释|枚举|取值|含义|代表|什么意思|表结构|schema)/i.test(t);
      };

      const ensureSearchContextWithSchema = async () => {
        await ensureSearchContext();
        if (!candidateTables[0]) return;
        if (/候选表结构/.test(searchContext)) return;
        try {
          const modelRoutingOnly = String(process.env.DB_AGENT_MODEL_ROUTING_ONLY || "").toLowerCase() === "true";
          if (modelRoutingOnly && !wantsSchemaHint(userCue)) return;
          const maxSchemaTables = Math.min(blueprintEnv.schemaSummaryMaxTables, candidateTables.length);
          const perTableChars = blueprintEnv.schemaSummaryCharsPerTable;
          const parts: string[] = [];
          for (let i = 0; i < maxSchemaTables; i++) {
            const tbl = candidateTables[i];
            if (!tbl) continue;
            const schemaText = await introspectSchemaWithComments(ds, `schema:${tbl}`);
            const compact = compactSchemaHint(String(schemaText || ""), 16);
            if (!compact) continue;
            parts.push(`表 \`${tbl}\`（列与注释摘要）\n${clipText(compact, perTableChars)}`);
          }
          if (parts.length) {
            const body = clipText(parts.join("\n\n"), perTableChars * maxSchemaTables + 120);
            searchContext += `候选表结构（仅下列表；请严格依据注释中的列名与业务含义编写 WHERE/JOIN，勿假设未出现的表）：\n${body}\n\n`;
          }
        } catch {}
      };

      const augmentSqlAgentContext = async () => {
        const ground = ctx?.schemaGround;
        if (ground?.candidate_tables?.length && ground.schema_summary?.trim()) {
          candidateTables = ground.candidate_tables.slice(0, blueprintEnv.schemaSummaryMaxTables);
          searchContext = clipText(`\n\n${formatSchemaGroundForAgent(ground)}`, 1350);
          const primaryTables = ground.table_judge?.primary_tables ?? [];
          const skipExplore = Boolean(ground.table_judge_hint) || primaryTables.length > 0;
          if (blueprintEnv.enableExplore && !skipExplore && !/\[数据探索\]/.test(searchContext)) {
            try {
              const explore = await buildExploratoryDataContext(ds, candidateTables, {
                maxTables: 1,
                maxTotalChars: 450,
                primaryTables,
                progress,
              });
              if (String(explore || "").trim()) {
                searchContext = (searchContext || "") + (searchContext ? "\n\n" : "") + explore.trim();
              }
            } catch {}
          }
          if (
            blueprintEnv.enableBlueprintHints &&
            DB_AGENT_DEFAULTS.enableBlueprintLlmSelect &&
            !ground.table_judge_hint &&
            String(userCue || "").trim().length >= 6 &&
            !/\[查询规划提示\]/.test(searchContext)
          ) {
            const blueprintHints = await getSqlBlueprintTemplateHints(largerModel ?? model, userCue);
            if (blueprintHints.trim()) {
              searchContext = (searchContext || "") + blueprintHints.trim();
            }
          }
          return;
        }
        if (shouldPreSearch(userCue)) {
          await ensureSearchContextWithSchema();
          if (candidateTables.length > 0 && !/\[数据探索\]/.test(searchContext)) {
            try {
              const explore = await buildExploratoryDataContext(ds, candidateTables, {
                maxTables: blueprintEnv.exploreMaxTables,
                maxTotalChars: blueprintEnv.exploreMaxChars,
                progress,
              });
              if (String(explore || "").trim()) {
                searchContext = (searchContext || "") + (searchContext ? "\n\n" : "") + explore.trim();
              }
            } catch {}
          }
        }
        if (
          blueprintEnv.enableBlueprintHints &&
          DB_AGENT_DEFAULTS.enableBlueprintLlmSelect &&
          String(userCue || "").trim().length >= 6 &&
          !/\[查询规划提示\]/.test(searchContext)
        ) {
          const blueprintHints = await getSqlBlueprintTemplateHints(largerModel ?? model, userCue);
          if (blueprintHints.trim()) {
            searchContext = (searchContext || "") + blueprintHints.trim();
          }
        }
      };

      const agent = await getAgent(config);
      progress?.("正在分析数据并生成回答...");
      const invokeAgent = async (input: string) => {
        const result = await agent.invoke({ input: input || clipText(modelQuestion, blueprintEnv.maxModelInputChars) });
        const output = (result as any)?.output ?? result;
        const intermediateSteps = (result as any)?.intermediateSteps;
        const stats = getAgentSqlQueryStats(intermediateSteps);
        const lastSql = extractLastSqlRows(intermediateSteps, {
          nameHints: extractNameCandidatesFromQuestion(userCue),
        });
        const rawText = typeof output === "string" ? output : JSON.stringify(output, null, 2);
        const rawHitMaxIterations = /(agent\s+stopped\s+due\s+to\s+max\s+iterations|max\s+iterations)/i.test(rawText);
        const cleaned = sanitizeAssistantTextForPlan(rawText, ctx?.queryPlan);
        let text = humanizeAssistantText(userCue, cleaned).trim();
        if (!text) {
          if (stats.queryCount > 0 && stats.nonEmptyResultCount === 0) {
            text = "按当前条件在库里没有匹配到数据。若您确定应有记录，可以说一下大致时间或业务场景，我再帮您收窄检索。";
          } else if (stats.queryCount > 0) {
            // 由下游用 SQL 行 + 列注释确定性渲染，避免弱模型空 Final Answer 却浪费 token 重试
            text = "";
          } else {
            text = "暂时没能从库里跑出有效查询。补充一下姓名、时间或表/业务里常出现的词，我可以再试一版。";
          }
        }
        return { text, stats, rawHitMaxIterations, intermediateSteps, lastSql };
      };
      await augmentSqlAgentContext();
      const firstInput = searchContext
        ? mergeWithBudget(modelQuestion, searchContext, blueprintEnv.maxModelInputChars)
        : clipText(modelQuestion, blueprintEnv.maxModelInputChars);
      const first = await invokeAgent(firstInput);
      const stats = first.stats;
      if (stats.queryCount > 0) {
        progress?.(`已完成 ${stats.queryCount} 次数据检索`);
      }
      const hitMaxIterations =
        first.rawHitMaxIterations ||
        /(agent\s+stopped\s+due\s+to\s+max\s+iterations|max\s+iterations)/i.test(first.text);
      const isCountQuestion = isCountQueryFromPlan(ctx?.queryPlan);
      const executionShapeFromPlan = inferExecutionShapeStructural(ctx?.queryPlan)?.shape;
      const wantsRows =
        /(记录|明细|列表|检测|测量|日志|数据|最近|最新|历史|详情|详细|基本信息|完整|全部字段|全字段|所有字段|测试|报告|压力|足底|轨迹)/.test(
          userCue,
        );
      const renderRowsIfNeeded = async (agentTry: { text: string; lastSql: any; stats: any }, rawText: string) => {
        const lastSql = agentTry?.lastSql;
        const st = agentTry?.stats ?? { queryCount: 0, nonEmptyResultCount: 0 };
        if (!lastSql?.rows?.length) return null;
        const t = String(rawText || "").trim();

        if (isCountQuestion && lastSql.rows.length === 1) {
          const row = lastSql.rows[0] as Record<string, unknown>;
          const vals = Object.values(row).filter((v) => v !== null && v !== undefined);
          if (vals.length === 1) {
            const v0 = vals[0];
            if (typeof v0 === "number" || /^\d+(?:\.\d+)?$/.test(String(v0).trim())) {
              return formatValueAnswer(userCue, String(v0), {
                queryPlan: ctx?.queryPlan,
                executionShape: executionShapeFromPlan === "scalar_lookup" ? "scalar_lookup" : undefined,
              });
            }
          }
        }
        if (
          lastSql.rows.length === 1 &&
          ctx?.queryPlan?.metrics?.length &&
          !isCountQueryFromPlan(ctx.queryPlan) &&
          executionShapeFromPlan === "scalar_lookup"
        ) {
          const row = lastSql.rows[0] as Record<string, unknown>;
          const entries = Object.entries(row).filter(([, v]) => v !== null && v !== undefined && String(v).trim());
          if (entries.length === 1) {
            return formatValueAnswer(userCue, String(entries[0]![1]), {
              queryPlan: ctx.queryPlan,
              executionShape: "scalar_lookup",
            });
          }
        }

        const llmUseless = /已完成数据检索|未生成可展示/.test(t);
        const wantsRowUi = wantsRows || (st.nonEmptyResultCount > 0 && (!t || llmUseless));
        if (!wantsRowUi) return null;
        const forceFull =
          /(不要遗漏|不遗漏|全部字段|所有字段|完整字段|全字段|全部信息|所有信息|全部有用|所有有用|明细|详情)/.test(
            String(userCue ?? "").replace(/\s+/g, ""),
          ) || /(基本信息|详细|完整)/.test(String(userCue ?? "").replace(/\s+/g, ""));
        const alreadyLooksLikeList = /\n\s*-\s+/.test(t) || /记录\s*\d+/.test(t);
        if (alreadyLooksLikeList && !forceFull) return null;
        const rows = Array.isArray(lastSql.rows) ? lastSql.rows : [];
        if (!rows.length) return null;

        const nameHintsRow = extractNameCandidatesFromQuestion(userCue);
        let rowsForDisplay = rows;
        if (nameHintsRow.length > 0) {
          const hasPersonNameCol = rows.some(
            (r) => r && typeof r === "object" && Object.keys(r as object).some((k) => isLikelyPersonNameColumn(k)),
          );
          if (hasPersonNameCol) {
            const filtered = rows.filter((r) => rowMatchesAnyNameHint(r, nameHintsRow));
            if (filtered.length > 0) rowsForDisplay = filtered;
            else if (sqlTextContainsAllNameHints(String(lastSql?.toolInput || ""), nameHintsRow)) {
              rowsForDisplay = rows;
            } else {
              return sanitizeAssistantText(
                `未在查询结果中找到与「${nameHintsRow[0]}」匹配的记录。已隐藏他人数据，避免误展示。\n\n当前 SQL 可能未按姓名过滤；请核对姓名，或在问题中使用「某某的……」以便系统约束姓名条件。`,
              );
            }
          }
        }

        const limit = (() => {
          const m = String(userCue ?? "").replace(/\s+/g, "").match(/最近(\d{1,2})次/);
          const n = m?.[1] ? Number(m[1]) : NaN;
          if (Number.isFinite(n) && n > 0) return Math.max(1, Math.min(20, Math.floor(n)));
          if (/(最新|最近)/.test(userCue) && !/(最近几|最近多次|近\d+次)/.test(userCue)) return 1;
          return 5;
        })();
        const clippedRows = rowsForDisplay.slice(0, limit);
        const isSensitiveKey = (k: string) => {
          if (planRequestsContactReveal(ctx?.queryPlan) && /(phone|mobile|tel)/i.test(k)) return false;
          return /(id_card|idcard|身份证|phone|mobile|tel|password|passwd|secret|token)/i.test(k);
        };
        const isIdKey = (k: string) => {
          const s = String(k || "").trim().toLowerCase();
          if (!s) return true;
          if (s === "id") return true;
          if (s.endsWith("_id")) return true;
          if (s.startsWith("id_")) return true;
          if (s.includes("编号")) return true;
          return false;
        };
        let commentByName: Record<string, string> = {};
        let dataTypeByName: Record<string, string> = {};
        const table = String(lastSql.table || "").trim();
        let orderedKeysFromSchema: string[] = [];
        if (table) {
          try {
            const cols = await ds.query(
              "SELECT column_name AS name, COALESCE(column_comment,'') AS comment, LOWER(data_type) AS data_type, ordinal_position AS pos FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position",
              [table],
            );
            if (Array.isArray(cols)) {
              for (const r of cols as any[]) {
                const n = String(r?.name ?? "");
                if (n) {
                  commentByName[n] = String(r?.comment ?? "");
                  dataTypeByName[n] = String(r?.data_type ?? "").trim();
                }
              }
              orderedKeysFromSchema = (cols as any[])
                .map((r) => String(r?.name ?? ""))
                .filter(Boolean);
            }
          } catch {}
        }

        const maxCols = forceFull ? 240 : /(记录|明细|详情|测试|压力|报告|列表|日志)/.test(userCue) ? 120 : 80;

        const renderOne = (r: any) => {
          const obj = r && typeof r === "object" ? r : { value: r };
          const allKeys = Object.keys(obj);
          const filtered = allKeys.filter((k) => !isSensitiveKey(k) && !isIdKey(k));
          const schemaOrdered = orderedKeysFromSchema.length
            ? orderedKeysFromSchema.filter((k) => filtered.includes(k))
            : [];
          const rest = filtered
            .filter((k) => !schemaOrdered.includes(k))
            .sort((a, b) => a.localeCompare(b));
          const picked = [...schemaOrdered, ...rest].slice(0, maxCols);
          const lines: string[] = [];
          for (const k of picked) {
            const label = String(commentByName[k] || k).trim();
            const raw = (obj as any)[k];
            const shown = formatFieldValueForUser(k, commentByName[k] || "", dataTypeByName[k] || "", raw);
            lines.push(`- ${label}：${shown}`);
          }
          if (lines.length === 0) lines.push("- 暂无可展示字段");
          return lines;
        };

        const out: string[] = ["下面是按字段说明列出的明细：", ""];
        for (let i = 0; i < clippedRows.length; i++) {
          out.push(`记录 ${i + 1}：`);
          out.push(...renderOne(clippedRows[i]));
          out.push("");
        }
        return sanitizeAssistantTextForPlan(
          wrapConversationalDataReply(userCue, out.join("\n").trim()),
          ctx?.queryPlan,
        );
      };

      const rendered = await renderRowsIfNeeded(first, first.text);
      if (rendered) return rendered;

      const hasRenderableSqlRowsEarly = Boolean(first?.lastSql?.rows?.length);

      try {
        const last = first.lastSql as any;
        const meta = last?.meta;
        const toolInput = typeof last?.toolInput === "string" ? last.toolInput : "";
        const couldExplain = toolInput && /^(select|with)\b/i.test(toolInput.trim());
        if (shouldAttachPerfBlock(userCue, meta) && couldExplain) {
          let explainInsights: string[] = [];
          try {
            const checked = isReadOnlySelectSql(toolInput);
            if (checked.ok) {
              const safeMaxLimit = 100;
              const safeDefaultLimit = 20;
              const limited = enforceSelectLimit(checked.sql, safeMaxLimit, safeDefaultLimit);
              const withHint = injectMysqlMaxExecutionTimeHint(limited, 6000);
              const plan = await ds.query("EXPLAIN " + withHint.replace(/^\s*(select|with)\b/i, "$1"));
              explainInsights = parseExplainInsights(Array.isArray(plan) ? (plan as any[]) : []);
            }
          } catch {}
          const tips = buildSqlOptimizationTips(toolInput, explainInsights);
          if (tips.length) {
            const extra: string[] = ["", "性能与优化建议：", ...tips.map((t) => `- ${t}`)];
            const ms = Number(meta?.execution_ms ?? NaN);
            if (Number.isFinite(ms)) extra.push(`- 本次查询耗时：${Math.max(0, Math.floor(ms))}ms`);
            return sanitizeAssistantTextForPlan(`${first.text}\n${extra.join("\n")}`.trim(), ctx?.queryPlan);
          }
        }
      } catch {}

      const hasRenderableSqlRows = hasRenderableSqlRowsEarly;
      const llmAnswerEmpty = !String(first.text || "").trim();
      const sqlTextForGuard = String(first?.lastSql?.toolInput || "").trim();
      const businessGuardNeedsRetry =
        blueprintEnv.enableSqlBusinessGuard &&
        wantsRows &&
        stats.queryCount > 0 &&
        stats.nonEmptyResultCount > 0 &&
        (first?.lastSql?.rows?.length ?? 0) >= 1 &&
        sqlLikelyMissingExtractedNames(userCue, sqlTextForGuard);
      /** 已达步数上限但已有可查行集时，不再整轮重跑 Agent（避免重复刷工具、再次触顶） */
      const shouldFallback =
        (hitMaxIterations && !hasRenderableSqlRows) ||
        stats.queryCount === 0 ||
        (llmAnswerEmpty && !hasRenderableSqlRows) ||
        (isCountQuestion && stats.nonEmptyResultCount === 0) ||
        (wantsRows && stats.queryCount > 0 && stats.nonEmptyResultCount === 0) ||
        businessGuardNeedsRetry;

      if (shouldFallback) {
        let sqlGuardPrefix = "";
        if (businessGuardNeedsRetry) {
          progress?.("业务校验：问句含指定人员，SQL 可能未按姓名过滤，正在改写重试…");
          sqlGuardPrefix =
            "\n\n[业务校验]\n用户为「某某的……」式问法，但你上次执行的 SQL 文本中未出现该人员姓名。请先用 db_schema_introspect 确认**当前表**是否有姓名/人员类列并在 WHERE 中过滤；若无，再按注释 JOIN 其它表。禁止无人员条件返回多条他人明细。\n";
        }
        let retryHint = "";
        let retryLabel = "";
        if (hitMaxIterations) {
          progress?.("模型推理步数达到上限，正在收敛查询步骤并重试...");
          retryHint =
            "\n\n[收敛重试] 你刚才因迭代上限未完成任务。请严格按最短路径执行（合计：db_schema_introspect 至多 2 次，query-sql / sql_db_query 至多 2 次）：\n1) 用 db_schema_introspect 的 search: 关键词（含人名、测量类型如足底/压力）定位表，再用 schema:表名 确认姓名/时间列。\n2) 一条最终 SELECT 用 query-sql 执行（明细 LIMIT 20，时间倒序）。\n3) 若仍为空，仅允许再执行 1 次放宽 WHERE 的 SELECT。\n禁止反复 list/schema 空转。\n";
          retryLabel = "收敛策略";
        } else if (stats.queryCount === 0) {
          progress?.("未生成有效查询，正在优化策略并重试...");
          retryHint =
            "\n\n[工具优先重试] 请先使用 db_schema_introspect（旧名 db_schem-introspect） 搜索相关表与字段（search:关键词 / schema:表名 / sample:表名:3），确认后再调用 sql_db_query 执行 SQL。若问题包含姓名，请按姓名字段过滤。严禁直接口头回答。\n";
          retryLabel = "优化策略";
        } else if (stats.nonEmptyResultCount === 0) {
          progress?.("查询结果为空，正在尝试扩大搜索范围...");
          retryHint =
            "\n\n[结果为空重试] 你刚才的查询返回为空。请先使用 db_schema_introspect（旧名 db_schem-introspect） 搜索相关表与字段（search:关键词 / schema:表名 / sample:表名:3），重新确认目标表与过滤条件后，再调用 sql_db_query 执行 SQL。若问题包含姓名，请按姓名字段过滤。严禁直接口头回答。\n";
          retryLabel = "宽松策略";
        } else {
          progress?.("正在启动深度分析模式...");
          retryHint =
            "\n\n[深度模式] 请按如下步骤执行：\n1) 使用 db_schema_introspect（旧名 db_schem-introspect） 的 search:关键词 找到最相关的表（依据表/字段注释），必要时再 schema:表名 与 sample:表名:3 复核。\n2) 编写并调用 query-sql 执行 SELECT，确保包含足够业务字段。若是计数问题，用 COUNT(*)。\n3) 若查询结果为空，扩大条件（例如 LIKE、放宽时间范围）后再查。\n严禁不执行查询就直接口头回答。\n";
          retryLabel = "深度模式";
        }

        try {
          await augmentSqlAgentContext();
          const mergedQuestion = `${sqlGuardPrefix}${retryHint}${modelQuestion}`;
          const retryInput = mergeWithBudget(mergedQuestion, searchContext, blueprintEnv.maxModelInputChars);
          const second = await invokeAgent(retryInput || clipText(mergedQuestion, blueprintEnv.maxModelInputChars));
          const stats2 = second.stats;
          const rowSecond = await renderRowsIfNeeded(second, second.text);
          if (rowSecond) return sanitizeAssistantTextForPlan(rowSecond, ctx?.queryPlan);
          if (stats2.queryCount > 0 && (stats2.nonEmptyResultCount > 0 || !wantsRows)) {
            progress?.(`已通过${retryLabel}完成 ${stats2.queryCount} 次数据检索`);
            return second.text;
          }
          return second.text;
        } catch {}

        return friendlyFallbackMessage({
          question: userCue,
          routedIntent: "sql_agent",
          confidence: 0,
          reason: stats.queryCount === 0 ? "agent_no_sql_query" : "agent_empty_result",
        });
      }
      return first.text;
    } catch (e: any) {
      const err = typeof e?.message === "string" ? e.message : String(e);
      if (err.includes("Could not parse LLM output:")) {
        const recovered = err.replace("Could not parse LLM output:", "").trim();
        if (recovered) {
          return humanizeAssistantText(userCue, sanitizeAssistantTextForPlan(recovered, ctx?.queryPlan));
        }
      }
      return [
        "查询失败：",
        sanitizeAssistantText(err),
        "",
        "可以先调用 db_schema_introspect（旧名 db_schem-introspect） 查看表/字段注释或样例数据，再编写 SQL：",
        '- {"action":"list"} 或 {"action":"schema","table":"目标表"}，必要时 {"action":"sample","table":"目标表","limit":3}',
      ].join("\n");
    }
  };
  return agentExecutor;
}
