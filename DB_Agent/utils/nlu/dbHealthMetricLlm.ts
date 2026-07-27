/**
 * 健康指标 id 抽取：LLM 语义 + marker 结构性 fallback。
 */
import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";

const MetricSchema = z.object({
  metric_ids: z.array(z.string()).max(20).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

const METRIC_MARKER_MAP: Record<string, readonly string[]> = {
  height: ["身高", "身长"],
  weight: ["体重"],
  heart_rate: ["心率", "脉搏", "心跳", "bpm"],
  spo2: ["血氧", "血氧饱和度", "spo2"],
  temperature: ["体温", "温度"],
  bp: ["血压"],
  sbp: ["收缩压", "高压"],
  dbp: ["舒张压", "低压"],
  glucose: ["血糖"],
  bmi: ["bmi", "体质指数"],
  bmr: ["基础代谢", "基础代谢率", "bmr"],
  uric_acid: ["尿酸"],
  chol: ["总胆固醇"],
  hdl: ["高密度脂蛋白", "hdl"],
  ldl: ["低密度脂蛋白", "ldl"],
  tg: ["甘油三酯", "三酰甘油", "tg"],
  left_vision: ["左眼视力"],
  right_vision: ["右眼视力"],
  left_hearing: ["左耳听力"],
  right_hearing: ["右耳听力"],
  muscle_rate: ["肌肉率"],
  fat_rate: ["体脂率"],
  visceral_fat: ["内脏脂肪"],
  waist: ["腰围"],
  hip: ["臀围", "髋围"],
  water_rate: ["水分率", "水分"],
  bone_mass: ["骨量"],
};

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

export function isDbHealthMetricLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("health_metric");
}

export function extractHealthMetricIdsStructural(question: string): string[] {
  const t = String(question ?? "")
    .replace(/\s+/g, "")
    .replace(/[()（）]/g, "")
    .replace(/(mmhg|mmol\/l|kg|cm|kcal|%|\/分钟)/gi, "")
    .toLowerCase();
  const out: string[] = [];
  for (const [id, markers] of Object.entries(METRIC_MARKER_MAP)) {
    if (markers.some((m) => t.includes(m.toLowerCase()))) out.push(id);
  }
  if (out.includes("bp")) {
    if (!out.includes("sbp")) out.push("sbp");
    if (!out.includes("dbp")) out.push("dbp");
  }
  return Array.from(new Set(out));
}

export async function extractHealthMetricIdsByLlm(
  model: ChatOpenAI | null,
  question: string,
): Promise<string[] | null> {
  if (!model) return null;
  const q = String(question ?? "").trim().slice(0, 600);
  if (!q) return null;
  try {
    const res = await model.invoke([
      [
        "system",
        [
          "你是健康指标解析器。从用户问题提取要查询的健康指标 id 列表，只输出 JSON。",
          "可用 id：height,weight,heart_rate,spo2,temperature,bp,sbp,dbp,glucose,bmi,bmr,uric_acid,chol,hdl,ldl,tg,left_vision,right_vision,left_hearing,right_hearing,muscle_rate,fat_rate,visceral_fat,waist,hip,water_rate,bone_mass",
          'schema: {"metric_ids":string[],"confidence":number}',
        ].join("\n"),
      ],
      ["human", q],
    ]);
    const parsed = MetricSchema.safeParse(safeJsonParse(String((res as { content?: string })?.content ?? "")));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.45) return null;
    const ids = parsed.data.metric_ids.filter((id) => id in METRIC_MARKER_MAP);
    if (ids.includes("bp")) {
      if (!ids.includes("sbp")) ids.push("sbp");
      if (!ids.includes("dbp")) ids.push("dbp");
    }
    return Array.from(new Set(ids));
  } catch {
    return null;
  }
}

export async function resolveHealthMetricIds(model: ChatOpenAI | null, question: string): Promise<string[]> {
  const structural = extractHealthMetricIdsStructural(question);
  if (!isDbHealthMetricLlmEnabled()) return structural;
  if (structural.length >= 2) return structural;
  const llm = await extractHealthMetricIdsByLlm(model, question);
  return llm?.length ? llm : structural;
}
