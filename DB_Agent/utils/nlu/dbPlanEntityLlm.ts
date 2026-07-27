/**
 * /api/plan 实体抽取：LLM + 结构性 fallback（替代 plan.post 正则）。
 */
import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { extractNameCandidatesFromQuestion, resolveNameCandidates } from "./signals";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";

export type PlanEntities = {
  names: string[];
  dates: string[];
  records: string[];
  locations: string[];
};

const PlanEntitySchema = z.object({
  names: z.array(z.string()).max(8).default([]),
  dates: z.array(z.string()).max(8).default([]),
  records: z.array(z.string()).max(8).default([]),
  locations: z.array(z.string()).max(8).default([]),
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

export function isDbPlanEntityLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("plan_entity");
}

export function inferPlanEntitiesStructural(question: string): PlanEntities {
  const names = extractNameCandidatesFromQuestion(question).slice(0, 8);
  return { names, dates: [], records: [], locations: [] };
}

export async function extractPlanEntitiesByLlm(
  model: ChatOpenAI | null,
  question: string,
): Promise<PlanEntities | null> {
  if (!model) return null;
  const q = String(question ?? "").trim();
  if (!q || q.length < 2) return null;
  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是数据库规划实体解析器。从中文问句提取结构化实体，只输出 JSON。",
          "names：人名/机构名；dates：时间表达（本月、2024年等）；records：记录/业务类型词；locations：地区/地址。",
          "按语义理解，勿用固定关键词表。无则空数组。",
          'schema: {"names":[],"dates":[],"records":[],"locations":[],"confidence":number}',
        ].join("\n"),
      ],
      ["human", q.slice(0, 900)],
    ]);
    const parsed = PlanEntitySchema.safeParse(
      safeJsonParse(String((res as { content?: string })?.content ?? "")),
    );
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.4) return null;
    return {
      names: parsed.data.names.map((x) => String(x).trim()).filter(Boolean),
      dates: parsed.data.dates.map((x) => String(x).trim()).filter(Boolean),
      records: parsed.data.records.map((x) => String(x).trim()).filter(Boolean),
      locations: parsed.data.locations.map((x) => String(x).trim()).filter(Boolean),
    };
  } catch {
    return null;
  }
}

export async function resolvePlanEntities(model: ChatOpenAI | null, question: string): Promise<PlanEntities> {
  if (isDbPlanEntityLlmEnabled()) {
    const llm = await extractPlanEntitiesByLlm(model, question);
    if (llm && (llm.names.length || llm.dates.length || llm.records.length || llm.locations.length)) {
      return llm;
    }
  }
  return inferPlanEntitiesStructural(question);
}
