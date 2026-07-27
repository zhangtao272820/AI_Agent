/**
 * 失败反思：空结果/SQL 错误时由模型生成一条可写入 prompt 补丁的纠正要点。
 * composeFriendlyAssistantReply：面向用户的友好回复（非固定话术，由模型生成）。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { clipText } from "./nlu/text";
import { appendPromptPatch } from "./prompt_evolution";
import { loadDomainPatch } from "./domain_patch";

const REFLECT_SYSTEM = `你是数据库查询失败分析器。根据用户问题、执行路径与失败原因，输出**一条**中文纠正要点（不超过 80 字），供下次类似问题改进 SQL 生成。
不要输出 SQL；不要复述表名列表；聚焦：是否漏 JOIN、是否查错表、是否漏姓名/时间条件、是否把健康/明细当成基础信息。`;

const REFLECT_HUMAN = `用户问题：{question}
执行路径：{path}
数据域：{data_domain}
失败原因：{reason}
候选表：{tables}

只输出一条纠正要点：`;

export type FriendlyReplyKind = "out_of_scope" | "help" | "empty_query" | "no_schema" | "query_failed";

const FRIENDLY_SYSTEM = `你是「养老信息数据库」问答助手，面向业务用户（非技术人员）。
请根据场景用自然、友好、简洁的中文回复（通常 2–5 句），像真人同事一样交流。

硬性要求：
- 禁止机械套话、禁止固定模板、禁止每次相同开场白。
- 不要暴露表名、字段名、SQL、主键、内部路由等技术细节。
- 若用户问题与当前业务库无关，礼貌说明你能做什么，并引导对方用业务语言描述要查的对象/指标/时间。
- 若查询未命中数据，结合上下文给出可操作的补充建议（姓名、时间范围、指标名称等），不要指责用户。
- 若只是问候或问能力，简要介绍可支持的查询类型，并给 1–2 个贴合养老场景的示例问法。
- 只输出给用户看的正文，不要输出 JSON 或标题行。`;

const FRIENDLY_HUMAN = `场景：{kind_label}
用户原话：{question}
数据域：{data_domain}
执行路径：{path}
失败原因：{reason}
候选表（仅供你理解，勿写入回复）：{tables}
内部改进要点（仅供你理解，勿原样复述）：{internal_hint}
当前库能力提示（仅供你理解）：{capability_hint}

请直接输出回复正文：`;

const KIND_LABELS: Record<FriendlyReplyKind, string> = {
  out_of_scope: "问题与当前业务数据库无关，或属于闲聊/常识/外部信息",
  help: "用户问候或咨询助手能做什么",
  empty_query: "已尝试查询但无匹配结果",
  no_schema: "未能匹配到相关数据表或 Schema 接地失败",
  query_failed: "查询执行未得到满意结果",
};

function buildCapabilityHint(): string {
  const patch = loadDomainPatch();
  const hints = (patch.blueprint.hints ?? [])
    .map((h) => String((h as { text?: string })?.text ?? h ?? "").trim())
    .filter(Boolean)
    .slice(0, 6);
  return hints.length ? hints.join("；") : "人员档案、健康体征、足底压力、护理与活动记录等";
}

export async function composeFriendlyAssistantReply(
  model: BaseLanguageModel,
  input: {
    kind: FriendlyReplyKind;
    question: string;
    data_domain?: string;
    path?: string;
    reason?: string;
    tables?: string[];
    internal_hint?: string;
    capability_hint?: string;
  },
): Promise<string> {
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", FRIENDLY_SYSTEM],
    ["human", FRIENDLY_HUMAN],
  ]);
  try {
    const raw = await RunnableSequence.from([prompt, model, new StringOutputParser()]).invoke({
      kind_label: KIND_LABELS[input.kind] ?? KIND_LABELS.query_failed,
      question: clipText(input.question, 300),
      data_domain: String(input.data_domain || "general"),
      path: String(input.path || "other"),
      reason: clipText(String(input.reason || ""), 160),
      tables: (input.tables || []).slice(0, 4).join("、"),
      internal_hint: clipText(String(input.internal_hint || ""), 200),
      capability_hint: clipText(input.capability_hint || buildCapabilityHint(), 400),
    });
    const text = clipText(String(raw ?? "").trim(), 900);
    return text || "";
  } catch {
    return "";
  }
}

export async function reflectOnQueryFailure(
  model: BaseLanguageModel,
  input: {
    question: string;
    path: string;
    data_domain?: string;
    reason?: string;
    tables?: string[];
  },
): Promise<string> {
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", REFLECT_SYSTEM],
    ["human", REFLECT_HUMAN],
  ]);
  try {
    const raw = await RunnableSequence.from([prompt, model, new StringOutputParser()]).invoke({
      question: clipText(input.question, 200),
      path: String(input.path || "sql_agent"),
      data_domain: String(input.data_domain || "general"),
      reason: clipText(String(input.reason || "empty_or_wrong"), 120),
      tables: (input.tables || []).slice(0, 4).join("、"),
    });
    const hint = clipText(String(raw ?? "").trim(), 120);
    if (hint) {
      appendPromptPatch({ stage: "sql", text: hint, source: "reflection" });
    }
    return hint;
  } catch {
    return "";
  }
}
