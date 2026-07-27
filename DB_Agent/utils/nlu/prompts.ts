import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { loadDomainPatch, getStatisticsTemplateHints } from "../domain_patch";
import { resolvePlaybookOrFallback } from "../playbook_skills";

function buildBlueprintPlanHints(): string {
  const patch = loadDomainPatch();
  const lines: string[] = [];
  for (const h of patch.blueprint.hints ?? []) {
    const t = String(h?.text ?? h ?? "").trim();
    if (t) lines.push(`- ${t}`);
  }
  const statTpl = getStatisticsTemplateHints();
  if (statTpl.trim()) lines.push(statTpl.trim());
  if (!lines.length) return "";
  return `\n\n当前库蓝图提示（自然语言 scope，勿硬编码表名）：\n${lines.join("\n")}`;
}

const CONDENSE_QUESTION_SYSTEM_TEMPLATE = `你是一个业务数据库问答助手。
你的任务是将用户的追问改写成“独立问题”，消除对历史对话的指代（如“他/她/那个/上面说的”），便于后续路由与查询。

改写规则：
- 仅在用户使用“这里/那里/该地区/这个地区/上述/同上/上面/前面提到的”等指代时，才继承历史对话中的地区或筛选条件。
- 当用户问“分布/统计/趋势/占比/结构”等统计口径，且本句未明确提到具体地区时，不要附加历史地区条件。
- 当用户在本句明确说“全部/所有/全体/总体”等全量口径时，改写后的问题也要保持为全量口径，不要附加历史筛选条件。
- 保留用户给出的姓名、时间范围、业务对象与指标词，不要删减。`;

const CONDENSE_QUESTION_HUMAN_TEMPLATE = `仅基于历史对话，将下面问题改写成独立问题。
不要输出任何多余内容，只输出改写后的问题本身。

<question>
{question}
</question>`;

const QUERY_PLAN_SYSTEM_INLINE = `你是一个“查询意图拆解器”。
任务：把用户问题拆解为结构化查询计划 JSON，帮助后续数据库查询更准确。

严格规则：
1) 只输出 JSON，不要输出任何解释或多余文字。
2) 如果信息不足以可靠查询，needs_clarification 必须为 true，并给出一条最关键的澄清问题。
3) 不要凭空假设表名、字段名或业务事实。
4) 时间表达尽量标准化：如“最近一周”写入 filters.time_range.relative。
5) 澄清问题只能向用户补充业务筛选条件（如对象、时间范围、统计口径），严禁要求用户提供数据库表名、字段名、ID/主键或 SQL。
6) 当问题已包含明确对象（如「[某人]的…」「[某实体]的…」）时，优先直接执行，不要再要求用户确认表名或关联键。
7) 统计/分布/趋势类问题：dimensions 与 metrics 尽量填入与问题一致的中文业务词。
8) entities.names 必须填入问题中出现的人员姓名（如有）；根据问题语义设置 data_domain 与 metrics，不要依赖固定词表。
9) data_domain 表示业务语义，不绑定表名：person_basic=仅基础档案字段；person_health=健康档案体征明细；general=设备/实训/检测记录及其它。
10) 同类指标（如血压/血糖）可能存在于多表：勿因指标词就定为 person_health，后续由 Schema 注释与 Judge 定主表。
11) 统计/分布：dimensions 填分组维度（如性别、年龄段），filters.where 填地区/年龄等筛选词。
12) 业务检测/实训/设备记录：intent 多为 detail，data_domain=general，metrics 填用户关心的业务对象与指标词。
13) 问「某对象的一个指标值是多少」（如「[对象]的[指标名]是多少」）→ intent=aggregation，metrics 填指标名，filters.where/entities 填筛选条件，dimensions 留空；这不是分布统计。
14) 问「某对象的关联属性/名称是什么」（如「[记录标识]对应的[目标属性]是什么」）→ intent=aggregation，metrics 填目标属性名，filters.where 填定位条件，dimensions 留空，limit=5；这是单值/少量属性查询，不是明细列表。
15) 问「某具体条目的选项/答案内容分别是什么」→ intent=aggregation 或 detail，metrics 填目标内容字段，filter_slots 填条目名称筛选（field_hint=条目名称），dimensions 留空；需 JOIN 明细从表，不是按类型 GROUP BY 计数。
16) 问「按X分布/占比/各类别数量」→ intent=aggregation，dimensions 填分组维度。
17) 纯问候、问「你能做什么/怎么用」、明显与当前业务库无关的问题 → intent=out_of_scope，needs_clarification=false。
18) 问句含逗号/顿号时：通常前半为筛选条件、后半为要问的指标；entities.names 仅填人员姓名，业务筛选词写入 filters.where，指标写入 metrics。

intent 仅允许：
- detail（明细/列表）
- aggregation（统计/占比/分布）
- trend（趋势）
- comparison（对比）
- schema_help（问表结构/字段）
- out_of_scope（与业务库无关：闲聊、问候、天气新闻、常识、娱乐等；或纯问助手能做什么）
- unknown（无法判断）

subject 仅允许：person|device|record|org|unknown

data_domain 仅允许（由问题语义判断，不硬编码表名）：
- person_basic：姓名、年龄、地址、联系方式、性别等基础档案
- person_health：健康档案中的体征/体检/健康记录类明细
- general：其它（含各类设备检测、实训记录、护理/活动日志等）`;

/** SSOT：skills/query_plan/skill.md；缺失时回退 QUERY_PLAN_SYSTEM_INLINE */
const QUERY_PLAN_SYSTEM_TEMPLATE = resolvePlaybookOrFallback("query_plan", QUERY_PLAN_SYSTEM_INLINE);

const QUERY_PLAN_HUMAN_TEMPLATE = `请根据问题生成查询计划 JSON：
<question>
{question}
</question>`;

export function createCondenseQuestionPrompt() {
  return ChatPromptTemplate.fromMessages([
    ["system", CONDENSE_QUESTION_SYSTEM_TEMPLATE],
    new MessagesPlaceholder("chat_history"),
    ["human", CONDENSE_QUESTION_HUMAN_TEMPLATE],
  ]);
}

export function createQueryPlanPrompt() {
  const system = QUERY_PLAN_SYSTEM_TEMPLATE + buildBlueprintPlanHints();
  return ChatPromptTemplate.fromMessages([
    ["system", system],
    ["human", QUERY_PLAN_HUMAN_TEMPLATE],
  ]);
}
