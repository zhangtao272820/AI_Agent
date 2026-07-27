/**
 * Stage-2 槽位填充节点：按 intent 专用 prompt 抽取 QueryPlan 槽位。
 * 纯 LLM 语义理解，不对问句做业务词表/正则硬匹配。
 */
import { z } from "zod";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { DbQueryIntent } from "./dbQueryIntentLlm";
import type { QueryPlan } from "./query_plan";
import { defaultQueryPlan } from "./query_plan";
import { assemblePlanSlotsOrNull } from "./assemble_plan_slots";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";
import { incrementLlmCallCount } from "../llm_call_counter";
import { clipText } from "./text";

const SlotSchema = z.object({
  subject: z.enum(["person", "device", "record", "org", "unknown"]).optional(),
  data_domain: z.enum(["person_basic", "person_health", "general"]).optional(),
  entities: z
    .object({
      names: z.array(z.string()).max(8).optional(),
      locations: z.array(z.string()).max(8).optional(),
      orgs: z.array(z.string()).max(8).optional(),
      ids: z.array(z.string()).max(8).optional(),
    })
    .optional(),
  metrics: z.array(z.string()).max(12).optional(),
  dimensions: z.array(z.string()).max(8).optional(),
  filters: z
    .object({
      time_range: z
        .object({
          start: z.string().optional(),
          end: z.string().optional(),
          relative: z.string().optional(),
        })
        .optional(),
      where: z.array(z.string()).max(12).optional(),
      slots: z
        .array(
          z.object({
            field_hint: z.string(),
            value: z.string(),
            sql_match_value: z.string(),
          }),
        )
        .max(12)
        .optional(),
    })
    .optional(),
  sort: z
    .array(
      z.object({
        field: z.string(),
        direction: z.enum(["asc", "desc"]).optional(),
      }),
    )
    .max(4)
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
  confidence: z.number().min(0).max(1).optional(),
  missing_slots: z.array(z.string()).max(6).optional(),
  needs_clarification: z.boolean().optional(),
  clarification_question: z.string().optional(),
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

export function isDbQuerySlotLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("query_slot");
}

function slotSystemForIntent(intent: DbQueryIntent): string {
  const common = [
    "你是数据库问句槽位填充器（Stage-2）。已知 intent，只抽取结构化槽位 JSON，不输出解释。",
    "勿凭空假设表名/字段名；勿用关键词表或正则硬匹配。",
    "entities.names 仅填人员姓名；业务对象筛选词写入 filters.where；指标/属性写入 metrics。",
    "entities.locations 与 filters.slots（field_hint=region/location/地区）仅填纯行政区划名（如 [某区]），禁止带「数据库查/统计/查询」等动词前缀。",
    "年龄区间写入 filters.slots：field_hint 为 age_gte/age_lte 或 age，value 为数字或区间（如 70-79）。",
    "时间表达写入 filters.time_range.relative 或 start/end。",
  ];

  switch (intent) {
    case "attribute_lookup":
      return [
        ...common,
        `当前 intent=attribute_lookup：用户要查「某对象的一个或少数属性值/关联属性名称」。`,
        "规则：",
        "- metrics 填用户真正要问的目标属性（如「手机号」「题库名称」「绑定题库名称」）；禁止把锚点筛字段（如「课程名称」「名字」）写入 metrics",
        "- 锚点对象筛选只进 filters.where / filters.slots（field_hint 如「课程名称」），与 metrics 分离",
        "- filters.where 填可读筛选描述；filters.slots 填结构化筛选，每项含 field_hint/value/sql_match_value",
        "- sql_match_value：结合用户原话与 schema 语义，填适合写入 SQL LIKE/= 的匹配值；名称字段优先填更短、更可能命中的核心词，去掉「的试卷/的记录」等修饰语",
        "- dimensions 必须 []",
        "- limit 建议 5~10（关联名称集合可稍大）",
        'schema: {"metrics":["题库名称"],"entities":{"names":[]},"filters":{"where":["课程名称=测试课程"],"slots":[{"field_hint":"课程名称","value":"测试课程","sql_match_value":"测试课程"}]},"limit":10,"confidence":0-1}',
      ].join("\n");
    case "detail_list":
      return [
        ...common,
        `当前 intent=detail_list：用户要业务记录/明细列表。`,
        "metrics 填业务对象与关心字段；filters.where 填筛选；dimensions=[]；limit 默认 20。",
        'schema: {"subject":"person|record|...","data_domain":"...","metrics":[],"filters":{"where":[]},"limit":20,"confidence":number}',
      ].join("\n");
    case "distribution":
      return [
        ...common,
        `当前 intent=distribution：按维度分组统计或 filtered count。`,
        "dimensions 填分组维度（如性别）；metrics 填统计口径（人数/总数/性别分布）；filters.where 填可读筛选。",
        "地区与年龄必须进 filters.slots，且与 dimensions 分离：region/location → 区划名；数字年龄区间 → age_gte+age_lte（或 age=「70-79」），禁止只写 region。",
        "问句含行政区划时必须写 entities.locations 与 region slot，禁止只有年龄过滤而无地区（否则会变成全区人数）。",
        "若问题隐含年龄/群体统计口径且语义需要，写入 age_gte/age_lte（或 age 区间）；取值由语义与常识推断，勿写死业务常量。",
        "entities.locations 仅填纯区划名，禁止动词前缀；data_domain/subject 由 schema 与问句语义决定。",
        'schema: {"subject":"person","data_domain":"person_basic","dimensions":[],"metrics":[],"entities":{"locations":[]},"filters":{"where":[],"slots":[{"field_hint":"region","value":"","sql_match_value":""},{"field_hint":"age_gte","value":"","sql_match_value":""},{"field_hint":"age_lte","value":"","sql_match_value":""}]},"limit":30,"confidence":number}',
      ].join("\n");
    case "trend":
      return [
        ...common,
        `当前 intent=trend：时间序列/趋势。`,
        "dimensions 可填时间粒度；filters.time_range 填时间范围。",
        'schema: {"dimensions":[],"metrics":[],"filters":{"time_range":{},"where":[]},"confidence":number}',
      ].join("\n");
    case "comparison":
      return [
        ...common,
        `当前 intent=comparison：多组对比。`,
        "dimensions 填对比维度；filters.where 填各组条件要点。",
        'schema: {"dimensions":[],"metrics":[],"filters":{"where":[]},"confidence":number}',
      ].join("\n");
    case "schema_help":
      return [
        ...common,
        `当前 intent=schema_help：问表结构/字段。`,
        "metrics 填用户提到的表/字段业务词；needs_clarification=false。",
        'schema: {"metrics":[],"confidence":number}',
      ].join("\n");
    case "out_of_scope":
      return [
        ...common,
        `当前 intent=out_of_scope。needs_clarification=false；confidence 填 0.9。`,
        'schema: {"confidence":0.9}',
      ].join("\n");
    default:
      return [
        ...common,
        `当前 intent=unknown：尽量抽取 metrics、filters、entities。`,
        "数字年龄区间与地区写入 filters.slots；若问题隐含年龄/群体口径，由语义写出对应 age_* 槽，勿写死业务常量。",
        'schema: {"metrics":[],"filters":{"where":[],"slots":[]},"confidence":number}',
      ].join("\n");
  }
}

function mapIntentToPlanIntent(intent: DbQueryIntent): QueryPlan["intent"] {
  switch (intent) {
    case "attribute_lookup":
    case "distribution":
      return "aggregation";
    case "detail_list":
      return "detail";
    case "trend":
      return "trend";
    case "comparison":
      return "comparison";
    case "schema_help":
      return "schema_help";
    case "out_of_scope":
      return "out_of_scope";
    default:
      return "unknown";
  }
}

function mergeSlotsIntoPlan(intent: DbQueryIntent, slots: z.infer<typeof SlotSchema>): QueryPlan {
  const base = defaultQueryPlan();
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
  const ent = slots.entities ?? {};
  const tr = slots.filters?.time_range ?? {};
  const sortRaw = Array.isArray(slots.sort) ? slots.sort : [];
  const sort = sortRaw
    .map((s) => ({
      field: String(s?.field ?? "").trim(),
      direction: String(s?.direction ?? "").toLowerCase() === "asc" ? ("asc" as const) : ("desc" as const),
    }))
    .filter((s) => s.field);

  const limitDefault = intent === "attribute_lookup" ? 5 : intent === "detail_list" ? 20 : 30;
  const limit = Number.isFinite(slots.limit) ? Math.max(1, Math.min(100, Math.floor(slots.limit!))) : limitDefault;

  const slotRaw = Array.isArray(slots.filters?.slots) ? slots.filters!.slots! : [];
  const filterSlots = slotRaw
    .map((s) => ({
      field_hint: String(s?.field_hint ?? "").trim(),
      value: String(s?.value ?? "").trim(),
      sql_match_value: String(s?.sql_match_value ?? s?.value ?? "").trim(),
    }))
    .filter((s) => s.field_hint || s.value)
    .slice(0, 12);

  return {
    intent: mapIntentToPlanIntent(intent),
    subject: (["person", "device", "record", "org", "unknown"] as const).includes(slots.subject as any)
      ? (slots.subject as QueryPlan["subject"])
      : base.subject,
    data_domain: (["person_basic", "person_health", "general"] as const).includes(slots.data_domain as any)
      ? (slots.data_domain as QueryPlan["data_domain"])
      : intent === "attribute_lookup" || intent === "detail_list"
        ? "general"
        : base.data_domain,
    entities: {
      names: arr(ent.names),
      locations: arr(ent.locations),
      orgs: arr(ent.orgs),
      ids: arr(ent.ids),
    },
    metrics: arr(slots.metrics),
    dimensions: intent === "attribute_lookup" ? [] : arr(slots.dimensions),
    filters: {
      time_range: {
        start: String(tr.start ?? "").trim(),
        end: String(tr.end ?? "").trim(),
        relative: String(tr.relative ?? "").trim(),
      },
      where: arr(slots.filters?.where),
      slots: filterSlots,
    },
    sort,
    limit,
    confidence: Number.isFinite(slots.confidence) ? Math.max(0, Math.min(1, slots.confidence!)) : 0.72,
    missing_slots: arr(slots.missing_slots),
    needs_clarification: Boolean(slots.needs_clarification),
    clarification_question: String(slots.clarification_question ?? "").trim(),
  };
}

async function fillSlotsByLlm(
  model: BaseLanguageModel | null,
  question: string,
  intent: DbQueryIntent,
): Promise<QueryPlan | null> {
  if (!model) return null;
  const q = String(question ?? "").trim();
  if (!q) return null;
  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      ["system", slotSystemForIntent(intent)],
      ["human", clipText(`intent=${intent}\n问题：${q}`, 1000)],
    ]);
    const text = typeof (res as any)?.content === "string" ? (res as any).content : JSON.stringify((res as any)?.content);
    const parsed = SlotSchema.safeParse(safeJsonParse(text));
    if (!parsed.success) return null;
    if (Number(parsed.data.confidence ?? 0) < 0.4 && intent !== "out_of_scope") return null;
    const merged = mergeSlotsIntoPlan(intent, parsed.data);
    return assemblePlanSlotsOrNull(merged);
  } catch {
    return null;
  }
}

export async function resolveQueryPlanViaDecomposition(
  model: BaseLanguageModel | null,
  question: string,
  intent: DbQueryIntent,
): Promise<QueryPlan | null> {
  if (!isDbQuerySlotLlmEnabled()) return null;
  return fillSlotsByLlm(model, question, intent);
}
