/**
 * 查询结果列选择：由 LLM 根据用户问题与 QueryPlan 决定展示哪些列（替代正则/词表打分）。
 */
import { z } from "zod";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { QueryPlan } from "./query_plan";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";
import { clipText } from "./text";
import { incrementLlmCallCount } from "../llm_call_counter";

const PickSchema = z.object({
  display_columns: z.array(z.string()).max(6).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

function safeJsonParse(text: string): unknown {
  const s = String(text ?? "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function isDbResultColumnLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("result_column");
}

export async function pickDisplayColumnsByLlm(
  model: BaseLanguageModel | null,
  input: {
    question: string;
    queryPlan?: QueryPlan | null;
    available: { key: string; label: string }[];
  },
): Promise<string[] | null> {
  if (!model || !isDbResultColumnLlmEnabled()) return null;
  const keys = input.available.map((c) => c.key).filter(Boolean);
  if (!keys.length) return null;
  const plan = input.queryPlan;
  const lines = input.available.map((c) => `- ${c.key}${c.label && c.label !== c.key ? ` // ${c.label}` : ""}`).join("\n");
  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是数据库查询结果列选择器。根据用户问题、QueryPlan 与可用结果列，选出应展示给用户的列名（column key）。",
          "只输出 JSON。按语义理解，勿用关键词表或正则。",
          "规则：",
          "- 只选用户真正关心的业务列；优先 COMMENT 含义为标题/名称/内容/章节/素材的列。",
          "- 禁止选择审计/标识列：create_time、update_time、created_at、updated_at、create_by、update_by、deleted、各类 *_id（除非用户明确要编号）。",
          "- 属性/单值问法通常 1~3 列；若问关联属性名，不要选锚点对象名称列代替目标属性列。",
          "- 明细「分别是什么」优先多业务列，不要用创建/更新时间凑数。",
          'schema: {"display_columns":["col_key"],"confidence":0-1}',
        ].join("\n"),
      ],
      [
        "human",
        clipText(
          [
            `问题：${input.question}`,
            plan?.metrics?.length ? `metrics：${plan.metrics.join("、")}` : "",
            plan?.filters?.slots?.length
              ? `filter_slots：${plan.filters.slots.map((s) => `${s.field_hint}=${s.sql_match_value || s.value}`).join("；")}`
              : "",
            "可用列：",
            lines,
          ]
            .filter(Boolean)
            .join("\n"),
          1200,
        ),
      ],
    ]);
    const text = typeof (res as { content?: string })?.content === "string" ? (res as { content?: string }).content : "";
    const parsed = PickSchema.safeParse(safeJsonParse(text));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.45) return null;
    const keySet = new Set(keys);
    const picked = parsed.data.display_columns.map((k) => String(k).trim()).filter((k) => keySet.has(k));
    return picked.length ? picked : null;
  } catch {
    return null;
  }
}
