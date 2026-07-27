/**
 * 领域统计模板路由：QueryPlan + LLM 语义，替代 statisticsToolRaw 问句正则。
 */
import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";
import type { QueryPlan } from "./query_plan";
import type { StatisticsResult } from "../tools";
import { loadDomainPatch, getStatisticsTemplateHints } from "../domain_patch";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";

export type StatisticsKind = NonNullable<StatisticsResult>["kind"];

const RouteSchema = z.object({
  kind: z.enum([
    "new_trend",
    "age_trend",
    "gender_distribution",
    "age_distribution",
    "crowd_distribution",
    "region_distribution",
    "none",
  ]),
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

export function isDbStatisticsRouteLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("statistics_route");
}

function planBlob(plan?: QueryPlan | null, question?: string): string {
  return [
    String(question ?? ""),
    ...(plan?.dimensions ?? []),
    ...(plan?.metrics ?? []),
    ...(plan?.filters?.where ?? []),
    String(plan?.intent ?? ""),
  ]
    .join(" ")
    .replace(/\s+/g, "");
}

function blobHas(blob: string, parts: readonly string[]): boolean {
  return parts.some((p) => blob.includes(p));
}

/** 结构性：QueryPlan 槽位 + includes，不用正则词表硬匹配整句 */
export function inferStatisticsKindStructural(question: string, plan?: QueryPlan | null): StatisticsKind | null {
  const blob = planBlob(plan, question);
  if (!blob) return null;

  const trend = ["趋势", "变化", "增长"];
  const dist = ["分布", "占比", "结构"];

  if (blobHas(blob, ["新增", "录入", "注册", "建档"]) && blobHas(blob, trend)) return "new_trend";
  if (blobHas(blob, ["年龄", "岁"]) && blobHas(blob, trend)) return "age_trend";
  if (blob.includes("性别分布") || (blob.includes("性别") && blobHas(blob, dist))) return "gender_distribution";
  if (blob.includes("年龄分布") || blob.includes("岁数分布") || (blobHas(blob, ["年龄", "岁"]) && blobHas(blob, dist))) {
    return "age_distribution";
  }
  if (blobHas(blob, ["人群", "分类", "crowd"])) return "crowd_distribution";

  if (blob.includes("地区分布")) return "region_distribution";
  if (blobHas(blob, ["地区", "省", "市", "区县"]) && blobHas(blob, dist)) return "region_distribution";
  if (blob.includes("老人") && blob.includes("分布") && !blobHas(blob, ["年龄", "岁", "人群", "分类", "crowd"])) {
    return "region_distribution";
  }

  if (plan?.intent === "trend") return "age_trend";
  if (plan?.intent === "aggregation" && blobHas(blob, ["性别"])) return "gender_distribution";
  if (plan?.intent === "aggregation" && blobHas(blob, ["年龄", "岁"])) return "age_distribution";

  return null;
}

export async function inferStatisticsKindByLlm(
  model: ChatOpenAI | null,
  question: string,
  plan?: QueryPlan | null,
): Promise<StatisticsKind | null> {
  if (!model) return null;
  const q = String(question ?? "").trim();
  if (!q) return null;
  const hintBlock = getStatisticsTemplateHints();
  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是统计模板路由器。根据用户问题与 QueryPlan 选择唯一统计模板，只输出 JSON。",
          "kind=new_trend|age_trend|gender_distribution|age_distribution|crowd_distribution|region_distribution|none",
          "none：无法映射到固定 person_info 统计模板。",
          hintBlock ? `可选模板：\n${hintBlock}` : "",
          'schema: {"kind":string,"confidence":number}',
        ]
          .filter(Boolean)
          .join("\n"),
      ],
      [
        "human",
        [
          `问题：${q.slice(0, 600)}`,
          plan ? `intent=${plan.intent}` : "",
          plan?.dimensions?.length ? `dimensions=${plan.dimensions.join("、")}` : "",
          plan?.metrics?.length ? `metrics=${plan.metrics.join("、")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ],
    ]);
    const parsed = RouteSchema.safeParse(safeJsonParse(String((res as { content?: string })?.content ?? "")));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null;
    if (parsed.data.kind === "none") return null;
    return parsed.data.kind;
  } catch {
    return null;
  }
}

export async function resolveStatisticsKind(
  model: ChatOpenAI | null,
  question: string,
  plan?: QueryPlan | null,
): Promise<StatisticsKind | null> {
  const structural = inferStatisticsKindStructural(question, plan);
  if (!isDbStatisticsRouteLlmEnabled()) return structural;
  const llm = await inferStatisticsKindByLlm(model, question, plan);
  return llm ?? structural;
}
