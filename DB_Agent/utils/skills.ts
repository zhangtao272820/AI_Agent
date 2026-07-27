/**
 * 文件用途：Agent Skills（能力）注册与实现。
 *
 * 主要职责：
 * - 定义 Skill 的统一结构（id/title/description/examples/run），并在 createAgentSkills 中集中注册。
 * - 实现不同意图的处理逻辑：
 *   - person_info：从问题中抽取姓名与字段意图，优先走“直取/精确查询”，必要时回退到通用 SQL Agent。
 *   - statistics：执行统计类查询（分布/趋势等），并将结构化结果渲染为更友好的中文回答。
 *   - help：输出支持的能力与示例问题。
 *   - sql_agent：复杂/开放问题交给通用 SQL Agent 推理执行。
 *
 * 输出约束：
 * - 最终对外回复应避免包含数据库表名/库名、ID/编号等内部信息；必要时由输出清洗层统一处理。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DataSource } from "typeorm";
import {
  answerPersonQuery,
  extractPersonAttribute,
  extractPersonName,
  queryPersonFullInfoTool,
  queryPersonHealthRecordsTool,
  resolvePersonId,
  statisticsTool,
  statisticsToolRaw,
  type StatisticsResult,
} from "./tools";
import { sanitizeAssistantText } from "./text";
import { appendPlanKeywordsForStatisticsMatch, type QueryPlan } from "./nlu/query_plan";
import type { SqlPreflightResult } from "./sql_preflight";
import type { ManagerDbTaskContext } from "./manager_task_context";
import type { SchemaGroundResult } from "./schema_ground";
import { tryGenericStatistics } from "./generic_statistics";
import { recordQueryMetric } from "./query_metrics";
import { getDbAgentBlueprintEnv } from "./db_agent_env";
import {
  discoverSchemaRelations,
  loadTablesMeta,
  tryPersonHealthJoinQuery,
  type SchemaRelation,
} from "./schema_relations";
import { getMustTablesForDataDomain } from "./domain_patch";
import { wantsFullFieldsStructural } from "./nlu/dbSqlOutputShapeLlm";

export type AgentSkillId = "help" | "person_info" | "person_health" | "statistics" | "sql_agent";

/** 随请求传入：查询计划接地 + schema 检索用的短问句（避免技能文档干扰关键词）。 */
export type SkillRunContext = {
  queryPlan?: QueryPlan;
  schemaSearchHint?: string;
  /** 多节点编排 sql_preflight 输出，供 SQL Agent 拼接 [SQL 编排要点] */
  sqlPreflight?: SqlPreflightResult | null;
  /** Manager_Agent 传入的结构化拆解，供 SQL 路径优先落实 */
  managerTask?: ManagerDbTaskContext | null;
  /** plan 后内部 schema 接地结果 */
  schemaGround?: SchemaGroundResult | null;
  /** P4 路径策略提示块 */
  routeHint?: string;
};

export type AgentSkill = {
  id: AgentSkillId;
  enabled?: boolean;
  title: string;
  description: string;
  examples: string[];
  instruction: string;
  run: (question: string, ctx?: SkillRunContext) => Promise<string>;
};

type SkillDeps = {
  model: BaseLanguageModel;
  largerModel?: BaseLanguageModel;
  /** 轻量 NLU（如姓名 JSON 解析）；默认同 model */
  nluModel?: BaseLanguageModel;
  ds: DataSource;
  dbId?: string;
  domain?: string;
  enableDomainSkills?: boolean;
  agentExecutor: (question: string, ctx?: SkillRunContext) => Promise<string>;
};

type SkillDoc = {
  name: string;
  description: string;
  title: string;
  markdown: string;
};

function isModelRoutingOnly() {
  return false;
}

function parseSkillDoc(text: string): SkillDoc | null {
  const raw = String(text ?? "");
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const fm = lines.slice(1, end).join("\n");
  const body = lines.slice(end + 1).join("\n").trim();
  const getQuoted = (key: string) => {
    const m = fm.match(new RegExp(`^\\s*${key}\\s*:\\s*"(.*)"\\s*$`, "m"));
    if (m?.[1]) return m[1].trim();
    const m2 = fm.match(new RegExp(`^\\s*${key}\\s*:\\s*'(.*)'\\s*$`, "m"));
    if (m2?.[1]) return m2[1].trim();
    const m3 = fm.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)\\s*$`, "m"));
    return m3?.[1] ? String(m3[1]).trim().replace(/^["']|["']$/g, "") : "";
  };
  const name = getQuoted("name");
  const description = getQuoted("description");
  const title = (() => {
    const m = body.match(/^\s*#\s+(.+)\s*$/m);
    return (m?.[1] ?? "").trim();
  })();
  if (!name) return null;
  return { name, description, title, markdown: raw.trim() };
}

function loadSkillDocById(skillId: AgentSkillId): SkillDoc | null {
  const p = join(process.cwd(), ".trae", "skills", skillId, "SKILL.md");
  try {
    if (!existsSync(p)) return null;
    const txt = readFileSync(p, "utf8");
    const doc = parseSkillDoc(txt);
    if (!doc) return null;
    return doc;
  } catch {
    return null;
  }
}

function wrapWithSkillDoc(doc: SkillDoc | null, question: string) {
  const q = String(question ?? "").trim();
  if (!doc) return q;
  const title = String(doc.title || doc.name || "").trim();
  const desc = String(doc.description || "").trim();
  if (!title && !desc) return q;
  const hint = `${title || doc.name}${desc ? `：${desc}` : ""}`.trim();
  return hint ? `${q}\n\n[技能]\n${hint}\n` : q;
}

const PERSON_PARSE_SYSTEM = `你是一个“语义解析器”。
目标：从中文问题中抽取“姓名”和“属性”。

规则：
- 姓名：尽可能提取中文姓名或称谓（如张三、李四、王奶奶等，1-12 字）。
- 属性：从以下选项中选择一个，或在无明确属性时返回 "full_info"：
  - age（年龄/岁/多大）
  - gender（性别/男/女）
  - address（地址/住址/居住地/住在哪/在哪住/家住哪）
  - contacts（联系方式/联系人/紧急联系人/电话）
  - crowd（人群/分类）
  - selfcare（自理情况/自理）
  - live（居住情况/居住）
  - life（生活情况/生活）
  - full_info（未指定具体字段时）

输出：只允许 JSON：{{"name":"...","attribute":"age|gender|address|contacts|crowd|selfcare|live|life|full_info","confidence":0-1}}`;

const PERSON_PARSE_HUMAN = `问题：{question}
请直接输出 JSON。`;

const personParsePrompt = ChatPromptTemplate.fromMessages([
  ["system", PERSON_PARSE_SYSTEM],
  ["human", PERSON_PARSE_HUMAN],
]);

async function parsePersonQuery(model: BaseLanguageModel, question: string) {
  try {
    const resp = await model.invoke(await personParsePrompt.formatMessages({ question }));
    const text =
      typeof (resp as any)?.content === "string" ? (resp as any).content : JSON.stringify((resp as any)?.content);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const obj = JSON.parse(text.slice(start, end + 1));
      const attrList = ["age", "gender", "address", "contacts", "crowd", "selfcare", "live", "life", "full_info"];
      const attr = typeof obj?.attribute === "string" && attrList.includes(obj.attribute) ? obj.attribute : "full_info";
      const name = typeof obj?.name === "string" ? obj.name.trim() : "";
      const confidence = typeof obj?.confidence === "number" ? obj.confidence : 0;
      return { name, attribute: attr, confidence };
    }
  } catch {}
  return { name: "", attribute: "full_info", confidence: 0 };
}

function renderHelp(skills: AgentSkill[]) {
  const parts: string[] = ["你可以问这些类型的问题：", ""];
  let i = 1;
  for (const s of skills) {
    if (s.id === "help") continue;
    parts.push(`${i}) ${s.title}`);
    if (s.examples?.length) {
      for (const ex of s.examples.slice(0, 4)) parts.push(`- 例：${ex}`);
    } else if (s.description) {
      parts.push(`- ${s.description}`);
    }
    parts.push("");
    i += 1;
  }
  return parts.join("\n").trim();
}

function buildSqlAgentInput(doc: SkillDoc | null, question: string) {
  const q = String(question ?? "").trim();
  const base = wrapWithSkillDoc(doc, q);
  if (isModelRoutingOnly()) return base;
  if (wantsFullFieldsStructural(q)) {
    return `${base}\n\n[展示规范] 本问题偏明细查询：优先返回更完整的非敏感业务字段，并按“字段注释：值”逐项列出；除非用户要求简要，否则不要只返回少量摘要字段。`;
  }
  return base;
}

export function createAgentSkills(deps: SkillDeps): Record<AgentSkillId, AgentSkill> {
  const domainEnabled = Boolean(deps.enableDomainSkills);
  const docs: Record<AgentSkillId, SkillDoc | null> = {
    help: loadSkillDocById("help"),
    person_info: loadSkillDocById("person_info"),
    person_health: loadSkillDocById("person_health"),
    statistics: loadSkillDocById("statistics"),
    sql_agent: loadSkillDocById("sql_agent"),
  };

  const helpSkill: AgentSkill = {
    id: "help",
    enabled: true,
    title: docs.help?.title || "帮助与用法",
    description: docs.help?.description || "说明支持的查询类型与示例问题。",
    examples: ["你能做什么？", "支持哪些查询？", "怎么用？"],
    instruction: docs.help?.markdown || "",
    run: async (_question?: string, _ctx?: SkillRunContext) => "",
  };

  const personInfoSkill: AgentSkill = {
    id: "person_info",
    enabled: domainEnabled,
    title: docs.person_info?.title || "查个人信息（按姓名）",
    description: docs.person_info?.description || "按姓名查询老人/人员基本信息、联系方式、人群分类等。",
    examples: ["龙奶奶基本信息", "查询张三老人信息", "李四的电话", "王奶奶住址"],
    instruction: docs.person_info?.markdown || "",
    run: async (question: string, ctx?: SkillRunContext) => {
      if (!domainEnabled) {
        return await deps.agentExecutor(question, ctx);
      }
      const q = String(question ?? "").trim();
      const parsed = await parsePersonQuery(deps.nluModel ?? deps.model, q);
      if (parsed?.name && Number(parsed.confidence ?? 0) >= 0.45) {
        const v = await answerPersonQuery(deps.ds, q, {
          attr: parsed.attribute === "full_info" ? null : parsed.attribute,
          name: parsed.name,
        });
        if (v) return v;
      }
      const extractedName = (extractPersonName(q) ?? "").trim();
      const extractedAttr = extractPersonAttribute(q);
      // 快速路径：只在 person_info 主表查，查到即返回；查不到交给 sql_agent
      if (extractedName) {
        const v = await answerPersonQuery(deps.ds, q, { attr: extractedAttr, name: extractedName });
        if (v) return v;
      } else if (q.length <= 18) {
        const parsed = await parsePersonQuery(deps.nluModel ?? deps.model, q);
        if (parsed?.name) {
          const v = await answerPersonQuery(deps.ds, q, { attr: parsed.attribute, name: parsed.name });
          if (v) return v;
        }
      }
      const quick = await answerPersonQuery(deps.ds, q);
      if (quick) return quick;
      const keyword = (extractPersonName(q) ?? "").trim();
      if (keyword) {
        const text = await queryPersonFullInfoTool(deps.ds, keyword);
        if (text) return text;
      }
      // 快速路径查不到时，交给 sql_agent 自由搜索所有表；不要传 person_info 的 skill doc，避免限制搜索范围
      return await deps.agentExecutor(q, ctx);
    },
  };

  const statisticsSkill: AgentSkill = {
    id: "statistics",
    enabled: true,
    title: docs.statistics?.title || "统计分析（分布/趋势）",
    description: docs.statistics?.description || "分布、占比、趋势等统计口径。",
    examples: ["按地区分布？", "年龄分布？", "按月趋势？"],
    instruction: docs.statistics?.markdown || "",
    run: async (question: string, ctx?: SkillRunContext) => {
      const q = String(question ?? "").trim();
      const qForStats = appendPlanKeywordsForStatisticsMatch(q, ctx?.queryPlan);
      const generic = await tryGenericStatistics(deps.ds, {
        question: qForStats,
        queryPlan: ctx?.queryPlan,
        candidateTables: ctx?.schemaGround?.candidate_tables,
        nluModel: (deps.nluModel ?? deps.model) as import("@langchain/openai").ChatOpenAI,
      });
      if (generic) {
        recordQueryMetric({ path: "generic_stats", ok: true });
        return generic;
      }
      if (domainEnabled) {
        const text = await statisticsTool(deps.ds, qForStats, {
          model: (deps.nluModel ?? deps.model) as import("@langchain/openai").ChatOpenAI,
          plan: ctx?.queryPlan,
        });
        if (text) {
          recordQueryMetric({ path: "statistics", ok: true });
          return text;
        }
      }
      recordQueryMetric({ path: "statistics", ok: false, reason: "no_stats_match" });
      if (getDbAgentBlueprintEnv().agentFallbackOnlyOnHardFail) {
        return "未能按当前统计口径生成结果。请补充时间范围、分组维度或统计对象，我再帮您检索。";
      }
      recordQueryMetric({ path: "statistics", ok: false, reason: "fallback_sql_agent" });
      return await deps.agentExecutor(wrapWithSkillDoc(docs.statistics, q), ctx);
    },
  };

  const personHealthSkill: AgentSkill = {
    id: "person_health",
    enabled: true,
    title: docs.person_health?.title || "查个人健康信息（按姓名）",
    description:
      docs.person_health?.description ||
      "按姓名查询个人健康指标/健康记录；须从人员主表定位后再关联健康明细表（如 person_info.id = person_health_records.person_id）。",
    examples: ["张三的个人健康信息", "李四最近一次健康记录", "王奶奶的血压血糖情况", "龙奶奶健康档案"],
    instruction: docs.person_health?.markdown || "",
    run: async (question: string, ctx?: SkillRunContext) => {
      const q = String(question ?? "").trim();
      const planNames = (ctx?.queryPlan?.entities?.names ?? []).map((n) => String(n ?? "").trim()).filter(Boolean);
      const name = planNames[0] || extractPersonName(q) || "";

      if (!name) {
        return "请告诉我要查询的人员姓名，我再帮您查个人健康情况。";
      }

      const runJoin = async (tables: string[], relations: SchemaRelation[]) => {
        if (!relations.length || !tables.length) return null;
        const metas = await loadTablesMeta(deps.ds, tables);
        return tryPersonHealthJoinQuery(deps.ds, { personName: name, relations, tableMetas: metas });
      };

      let tables = [...(ctx?.schemaGround?.candidate_tables ?? [])];
      let relations = ctx?.schemaGround?.relations ?? [];

      // 1) schema 接地关联 → 确定性 JOIN
      try {
        const joined = await runJoin(tables, relations);
        if (joined) {
          recordQueryMetric({ path: "person_health", ok: true });
          return sanitizeAssistantText(joined);
        }
      } catch {
        /* fallback */
      }

      // 2) 强制 person_info + person_health_records 发现关联后再 JOIN（不经过 SQL Agent）
      try {
        const must = getMustTablesForDataDomain("person_health");
        const forceTables = Array.from(new Set([...tables, ...must]));
        const forcedRelations = await discoverSchemaRelations(deps.ds, forceTables);
        const joined = await runJoin(forceTables, forcedRelations);
        if (joined) {
          recordQueryMetric({ path: "person_health", ok: true });
          return sanitizeAssistantText(joined);
        }
        tables = forceTables;
        relations = forcedRelations;
      } catch {
        /* fallback */
      }

      // 3) 主表解析 id → 健康明细表
      try {
        const resolved = await resolvePersonId(deps.ds, q, { name });
        const kind = (resolved as any)?.kind;
        if (kind === "disambiguation") return (resolved as any).text as string;
        if (kind === "resolved") {
          const text = await queryPersonHealthRecordsTool(deps.ds, {
            personId: (resolved as any).personId as any,
            personName: (resolved as any).name as any,
            question: q,
            limit: wantsFullFieldsStructural(q) ? 20 : 5,
            nluModel: (deps.nluModel ?? deps.model) as import("@langchain/openai").ChatOpenAI,
          });
          if (text) {
            recordQueryMetric({ path: "person_health", ok: true });
            return sanitizeAssistantText(text);
          }
        }
      } catch {
        /* fallback */
      }

      recordQueryMetric({ path: "person_health", ok: false, reason: "empty_or_weak_answer" });
      return `未找到「${name}」的健康记录；请确认姓名是否正确，或该人员是否已有健康档案数据。`;
    },
  };

  const sqlAgentSkill: AgentSkill = {
    id: "sql_agent",
    enabled: true,
    title: docs.sql_agent?.title || "开放式分析（SQL Agent 推理）",
    description: docs.sql_agent?.description || "复杂/开放式问题，通过通用 SQL Agent 多步推理并执行查询。",
    examples: ["分析一下老人地区分布的异常点", "帮我看看哪些地方需要改进"],
    instruction: docs.sql_agent?.markdown || "",
    run: async (question: string, ctx?: SkillRunContext) => {
      const q = String(question ?? "").trim();
      return await deps.agentExecutor(buildSqlAgentInput(docs.sql_agent, q), ctx);
    },
  };

  const skills: Record<AgentSkillId, AgentSkill> = {
    help: helpSkill,
    person_info: personInfoSkill,
    person_health: personHealthSkill,
    statistics: statisticsSkill,
    sql_agent: sqlAgentSkill,
  };

  skills.help.run = async (_question?: string, _ctx?: SkillRunContext) => renderHelp(Object.values(skills));

  return skills;
}
