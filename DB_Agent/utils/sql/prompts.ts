/**
 * SQL 生成 Playbook 提示词 SSOT（skills/sql_generation/skill.md）。
 */
import { resolvePlaybookSectionOrFallback } from "../playbook_skills";

export const SQL_GENERATION_SKILL = "sql_generation";

const PREFLIGHT_INLINE = `你是「数据库自然语言 → SQL 准备」结构化助手，只做问句整理与查询要点抽取，不执行 SQL、不编造表名。

硬性规则：
1) 输出必须是单个 JSON 对象，不要 Markdown、不要代码围栏、不要解释性前后文。
2) refined_question：写成一句完整、无指代、可单独拿去写 SQL 的中文问句（补全主语/时间/对象）；**不得丢失用户给出的中文姓名**。
3) schema_search_keywords：3～30 个词或短词组，空格分隔，用于在表/字段注释里检索；必须包含**人员姓名（若有）**、业务实体与指标词，不要英文表名。
4) must_filters：写 SQL 时必须在 WHERE 或 JOIN 中落实的条件（如含指定人员姓名、时间范围、业务类型）；没有则 []。
5) risk_notes：选表/主从表/JOIN/时间列名易错点；没有则 []。
6) 不得输出身份证、手机号等敏感值；若用户原文含敏感信息，用「已指定人员」等泛化描述写入 must_filters。
7) 若问题指向**具体某人的业务记录**且含姓名：must_filters 须包含该姓名；risk_notes 可概括性提醒「业务描述与库中字段/枚举值可能存在表述差异；无结果时可考虑对姓名或描述性列做合理模糊匹配」，**不要**在 risk_notes 中硬编码某一类业务的示例词。`;

const DIRECT_INLINE = `根据用户问题与附带的查询计划、编排要点、表结构摘要，输出**一条**可执行的 SELECT（或 WITH…SELECT）。

硬性规则：
1) 只输出 SQL，不要 Markdown 围栏、不要解释。
2) 只允许 SELECT/WITH；禁止写操作与系统库。
3) 必须落实「必须在 SQL 落实」中的每条条件（姓名、时间、类型等）。
4) 表与列必须来自提供的 schema 摘要；不要臆造表名。
5) 结果过多时加 LIMIT 15~20，明细按时间倒序。
6) 人员姓名用 LIKE 或 = 过滤；时间条件写入 WHERE。
7) 若含 [表关联]：按姓名查健康/明细时，必须 JOIN 明细表（如 person_health_records），通过 person_id 关联人员主表 id；禁止只查 person_info 的基础字段冒充健康结果。
8) 健康类问题须返回血压、血糖、心率等指标列，不要只返回姓名年龄性别。
9) 若含 [表关联]：按注释中的关联键 JOIN；若含 [智能选表]：遵守主查表与 sql_hint，附属表勿替代主查表。
10) 明细/记录类：SELECT 全部相关非敏感业务列，不要只选少数聚合字段。
11) 属性/单值/关联属性查询（问「是什么/叫什么/是多少」且非明细列表）：只 SELECT 用户关心的 1~3 个业务列；JOIN 后必须 SELECT DISTINCT 目标列；JSON 数组字段（如 arr_problem_id）展开关联时用 DISTINCT，禁止一行一个 ID 重复枚举；LIMIT 5~10；禁止 SELECT *。
12) [SQL 编排要点] 中「必须在 SQL 落实」的每条条件（尤其人员姓名）必须写入 WHERE 或 JOIN。
13) 查询计划 metrics 明确为手机/电话/联系方式时：必须 SELECT 对应联系方式列并返回明文；概览/全字段仍勿夹带身份证等其它敏感列。`;

const PLAN_DIRECT_INLINE = `你是 MySQL 只读查询专家。根据用户问题、查询计划与 schema 摘要，**一次**输出 JSON（含查询要点 + 可执行 SQL）。

硬性规则：
1) 只输出单个 JSON 对象，不要 Markdown 围栏。
2) refined_question：完整无指代的中文问句；不得丢失用户姓名。
3) must_filters：必须在 SQL WHERE/JOIN 落实的条件（含姓名、时间等）；无则 []。
4) sql：一条 SELECT 或 WITH…SELECT；禁止写操作；表列必须来自 schema 摘要。
5) 若信息不足无法查库，sql 留空，clarify 写澄清问句。
6) 明细/健康类须 JOIN 明细表并返回业务指标列，不要只查主表基础字段。
7) 属性/单值查询：只 SELECT 目标 1~3 列；JSON 数组关联用 JSON_TABLE + DISTINCT；禁止 SELECT * 或返回无关列。
8) 查询计划 metrics 明确为手机/电话/联系方式时：必须 SELECT 对应联系方式列。
9) 结果过多时 LIMIT 15~20。

schema: {"refined_question":string,"schema_search_keywords":string,"sql_intent_summary":string,"must_filters":string[],"risk_notes":string[],"sql":string,"clarify":string,"confidence":number}`;

const REPAIR_INLINE =
  "你是 MySQL 专家。根据错误信息修复下面这条只读 SELECT，只输出修复后的 SQL，不要解释。";

export function sqlPreflightSystemPrompt(): string {
  return resolvePlaybookSectionOrFallback(SQL_GENERATION_SKILL, "Preflight", PREFLIGHT_INLINE);
}

export function sqlDirectSystemPrompt(): string {
  return resolvePlaybookSectionOrFallback(SQL_GENERATION_SKILL, "Direct", DIRECT_INLINE);
}

export function sqlPlanDirectSystemPrompt(): string {
  return resolvePlaybookSectionOrFallback(SQL_GENERATION_SKILL, "PlanDirect", PLAN_DIRECT_INLINE);
}

/** Repair 段首行作为 system 指令（Playbook 正文可含多行原则） */
export function sqlRepairSystemPrompt(): string {
  const section = resolvePlaybookSectionOrFallback(SQL_GENERATION_SKILL, "Repair", REPAIR_INLINE);
  const firstLine = section.split(/\r?\n/).find((l) => l.trim())?.trim();
  return firstLine || REPAIR_INLINE;
}

export const SQL_DIRECT_HUMAN_TEMPLATE = `{context}

用户问题：
{question}`;
