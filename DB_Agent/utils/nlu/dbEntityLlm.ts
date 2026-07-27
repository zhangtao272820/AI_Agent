/**
 * 人员/过滤条件 LLM 解析：替代 tools.ts 中的业务正则抽取。
 */
import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";
import { extractNameCandidatesFromQuestion } from "./signals";
import { incrementLlmCallCount } from "../llm_call_counter";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";

const EntitySchema = z.object({
  names: z.array(z.string()).max(3).default([]),
  attribute: z
    .enum(["age", "gender", "address", "contacts", "crowd", "selfcare", "live", "life", "full_info"])
    .nullable()
    .optional(),
  filters: z
    .object({
      id: z.string().optional(),
      gender: z.union([z.literal(1), z.literal(2)]).optional(),
      ageEq: z.number().int().optional(),
      ageGte: z.number().int().optional(),
      ageLte: z.number().int().optional(),
      regionLike: z.string().optional(),
    })
    .optional(),
  health_metric_ids: z.array(z.string()).max(12).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

export type DbEntityLlmResult = z.infer<typeof EntitySchema>;

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

export function isDbEntityLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("entity");
}

/** 结构性：signals 模块的人名候选，无业务关键词表 */
export function inferEntityStructural(question: string): DbEntityLlmResult {
  const names = extractNameCandidatesFromQuestion(question);
  return {
    names,
    attribute: null,
    health_metric_ids: [],
    confidence: names.length ? 0.55 : 0.3,
  };
}

export async function extractEntityByLlm(model: ChatOpenAI | null, question: string): Promise<DbEntityLlmResult | null> {
  if (!model) return null;
  const q = String(question ?? "").trim();
  if (!q || q.length < 2) return null;
  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是数据库问句实体解析器。从用户中文问题提取查询对象与过滤条件，只输出 JSON，禁止 markdown。",
          "勿用关键词表硬匹配；按语义理解人名、属性、年龄/性别/地区过滤、健康指标。",
          "names：人名候选（2-6 字中文），无则 []。",
          "attribute：age|gender|address|contacts|crowd|selfcare|live|life|full_info|null。",
          "filters：可选 id/gender(1男2女)/ageEq/ageGte/ageLte/regionLike。",
          "health_metric_ids：如 bp, glucose, heart_rate 等，无则 []。",
          'schema: {"names":string[],"attribute":string|null,"filters":object,"health_metric_ids":string[],"confidence":number}',
        ].join("\n"),
      ],
      ["human", q.slice(0, 1200)],
    ]);
    const parsed = EntitySchema.safeParse(safeJsonParse(String((res as { content?: string })?.content ?? "")));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.45) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function resolveDbEntity(
  model: ChatOpenAI | null,
  question: string,
  planNames?: string[],
): Promise<DbEntityLlmResult> {
  const fromPlan = (planNames ?? []).map((n) => String(n ?? "").trim()).filter(Boolean).slice(0, 3);
  if (fromPlan.length) {
    return { names: fromPlan, attribute: null, health_metric_ids: [], confidence: 0.85 };
  }
  if (isDbEntityLlmEnabled()) {
    const llm = await extractEntityByLlm(model, question);
    if (llm && (llm.names.length || llm.attribute || llm.filters)) return llm;
  }
  return inferEntityStructural(question);
}
