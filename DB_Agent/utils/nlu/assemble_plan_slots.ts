/**
 * Plan 槽位 SSOT：Zod 校验、去重、confidence 门槛；不读用户问句 regex。
 * 脏槽（含查询动词前缀）拒绝进入快路径，交 slot LLM 重抽或澄清。
 */
import { z } from "zod";
import type { QueryPlan } from "./query_plan";
import { defaultQueryPlan } from "./query_plan";

const MIN_SLOT_CONFIDENCE = 0.5;

const LocationSlotSchema = z.string().min(2).max(24);

/** 槽位值含查询动词视为脏槽（结构性检测，非业务关键词路由） */
const QUERY_VERB_IN_SLOT = /(?:数据库|数据|查询|统计|^查)/u;

function isDirtyLocationValue(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return true;
  return QUERY_VERB_IN_SLOT.test(t);
}

function normalizeAdminDivision(raw: string): string | null {
  const t = String(raw ?? "").trim();
  if (!t || isDirtyLocationValue(t)) return null;
  const parsed = LocationSlotSchema.safeParse(t);
  if (!parsed.success) return null;
  if (/^[\u4e00-\u9fff]{2,10}(?:区|市|县|省)$/.test(t)) return t;
  return t.length >= 2 && t.length <= 16 ? t : null;
}

function dedupeStrings(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const t = String(raw ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function parseAgeSlotValue(raw: string): { gte?: number; lte?: number } | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  // 允许嵌在更长 where/metric 文本中（如「70-79岁」）
  const range = t.match(/(\d{1,3})\s*[-~到至]\s*(\d{1,3})/);
  if (range) {
    const gte = Number(range[1]);
    const lte = Number(range[2]);
    if (Number.isFinite(gte) && Number.isFinite(lte) && gte <= lte) return { gte, lte };
  }
  const gteOnly = t.match(/^(?:≥|>=|gte:)?\s*(\d{1,3})$/i);
  if (gteOnly) {
    const gte = Number(gteOnly[1]);
    if (Number.isFinite(gte)) return { gte, lte: 120 };
  }
  return null;
}

function planHasAgeSlots(plan: QueryPlan): boolean {
  return (plan.filters?.slots ?? []).some((s) => String(s.field_hint ?? "").toLowerCase().includes("age"));
}

export type AssemblePlanSlotsResult =
  | { ok: true; plan: QueryPlan }
  | { ok: false; reason: "low_confidence" | "dirty_slots"; plan: QueryPlan };

/**
 * Plan 是否具备跳过 Stage-2 的**结构门槛**（CF-3）。
 * 语义是否真完备由 resolvePlanCompleteness（启发模型）裁决；此处不做「性别/分布/老人」关键词门。
 * 稀疏 stub（仅 intent+metrics、无过滤上下文）必须继续抽槽。
 */
export function queryPlanReadyToSkipSlotLlm(plan?: QueryPlan | null): boolean {
  if (!plan || plan.intent === "unknown") return false;

  const hasNames = (plan.entities?.names?.length ?? 0) > 0;
  const hasIds = (plan.entities?.ids?.length ?? 0) > 0;
  const hasWhere = (plan.filters?.where?.filter(Boolean).length ?? 0) > 0;
  const hasMetrics = (plan.metrics?.filter(Boolean).length ?? 0) > 0;
  const hasDimensions = (plan.dimensions?.filter(Boolean).length ?? 0) > 0;
  const hasFilterSlots = (plan.filters?.slots ?? []).some((s) => {
    const v = String(s.sql_match_value || s.value || "").trim();
    return Boolean(v && String(s.field_hint ?? "").trim());
  });
  // 仅有 entities.locations 不算结构完备（须 slots/where/names/ids）
  const hasFilterContext = hasFilterSlots || hasWhere || hasNames || hasIds;

  if (plan.intent === "detail") {
    return hasNames || hasIds || hasWhere;
  }
  if (plan.intent === "aggregation" || plan.intent === "trend" || plan.intent === "comparison") {
    if (!hasMetrics && !hasDimensions) return false;
    // 仅有 metrics 无过滤上下文 = 稀疏 stub，不可跳过 Stage-2
    return hasFilterContext;
  }
  if (plan.intent === "schema_help" || plan.intent === "out_of_scope") return true;
  return false;
}

/**
 * 合并 structural/LLM plan 后统一校验 locations / age slots。
 * confidence < 0.5 → 作废；脏 location → 剔除或整段拒绝。
 */
export function assemblePlanSlots(plan: QueryPlan): AssemblePlanSlotsResult {
  const base = { ...plan, entities: { ...plan.entities }, filters: { ...plan.filters, slots: [...(plan.filters.slots ?? [])] } };

  if (base.confidence > 0 && base.confidence < MIN_SLOT_CONFIDENCE) {
    return { ok: false, reason: "low_confidence", plan: base };
  }

  const cleanedLocations: string[] = [];
  let hadDirtyLocation = false;

  for (const loc of base.entities.locations ?? []) {
    const clean = normalizeAdminDivision(String(loc ?? ""));
    if (clean) cleanedLocations.push(clean);
    else if (String(loc ?? "").trim()) hadDirtyLocation = true;
  }

  for (const slot of base.filters.slots ?? []) {
    const hint = String(slot.field_hint ?? "").toLowerCase();
    if (hint.includes("region") || hint.includes("location") || hint.includes("地区")) {
      const clean = normalizeAdminDivision(String(slot.value ?? slot.sql_match_value ?? ""));
      if (clean) {
        cleanedLocations.push(clean);
        slot.value = clean;
        slot.sql_match_value = clean;
      } else if (String(slot.value ?? "").trim()) hadDirtyLocation = true;
    }
    if (hint.includes("age") || hint === "age_gte" || hint === "age_lte") {
      const age = parseAgeSlotValue(String(slot.value ?? ""));
      if (age?.gte != null && !base.filters.slots.some((s) => s.field_hint === "age_gte")) {
        base.filters.slots.push({
          field_hint: "age_gte",
          value: String(age.gte),
          sql_match_value: String(age.gte),
        });
      }
      if (age?.lte != null && age.lte < 120 && !base.filters.slots.some((s) => s.field_hint === "age_lte")) {
        base.filters.slots.push({
          field_hint: "age_lte",
          value: String(age.lte),
          sql_match_value: String(age.lte),
        });
      }
    }
  }

  // where/metrics 中的年龄区间文本 → 结构化 age 槽（读 plan 字段，非用户原话）
  if (!planHasAgeSlots(base)) {
    for (const blob of [...(base.filters.where ?? []), ...(base.metrics ?? [])]) {
      const age = parseAgeSlotValue(String(blob ?? ""));
      if (!age) continue;
      if (age.gte != null) {
        base.filters.slots.push({
          field_hint: "age_gte",
          value: String(age.gte),
          sql_match_value: String(age.gte),
        });
      }
      if (age.lte != null && age.lte < 120) {
        base.filters.slots.push({
          field_hint: "age_lte",
          value: String(age.lte),
          sql_match_value: String(age.lte),
        });
      }
      break;
    }
  }

  base.entities.locations = dedupeStrings(cleanedLocations);

  // where/metrics 中残留的行政区划名 → locations（读 Plan，非用户原话）
  if (!base.entities.locations.length) {
    for (const blob of [...(base.filters.where ?? []), ...(base.metrics ?? [])]) {
      const m = String(blob ?? "").match(/([\u4e00-\u9fff]{2,10}(?:区|市|县|省))/);
      if (!m?.[1] || isDirtyLocationValue(m[1])) continue;
      const clean = normalizeAdminDivision(m[1]);
      if (clean) {
        base.entities.locations.push(clean);
        if (!base.filters.slots.some((s) => String(s.field_hint ?? "").toLowerCase().includes("region"))) {
          base.filters.slots.push({
            field_hint: "region",
            value: clean,
            sql_match_value: clean,
          });
        }
        break;
      }
    }
  }

  if (hadDirtyLocation && !base.entities.locations.length) {
    return { ok: false, reason: "dirty_slots", plan: base };
  }

  return { ok: true, plan: base };
}

/** 低置信或脏槽时返回 null plan，供下游走澄清 / sql_direct */
export function assemblePlanSlotsOrNull(plan: QueryPlan | null | undefined): QueryPlan | null {
  if (!plan) return null;
  const result = assemblePlanSlots(plan);
  return result.ok ? result.plan : null;
}

export type QueryPlanExportResult = {
  plan: QueryPlan;
  slotRejectReason?: "low_confidence" | "dirty_slots";
};

/**
 * Graph 写入 query_plan_json 前的唯一出口：必经 assemblePlanSlots。
 * 清洗失败时保留 plan 供 clarify 节点使用，并附带 rejectReason。
 */
export function exportQueryPlanForState(plan: QueryPlan): QueryPlanExportResult {
  const result = assemblePlanSlots(plan);
  if (result.ok) return { plan: result.plan };
  return { plan: result.plan, slotRejectReason: result.reason };
}

export function mergeAndAssemblePlanSlots(primary: QueryPlan, patch?: Partial<QueryPlan> | null): QueryPlan | null {
  const d = defaultQueryPlan();
  const merged: QueryPlan = {
    ...d,
    ...primary,
    entities: { ...d.entities, ...primary.entities, ...(patch?.entities ?? {}) },
    filters: {
      ...d.filters,
      ...primary.filters,
      ...(patch?.filters ?? {}),
      slots: [
        ...(primary.filters.slots ?? []),
        ...(patch?.filters?.slots ?? []),
      ],
    },
    confidence: Math.max(primary.confidence ?? 0, patch?.confidence ?? 0),
  };
  return assemblePlanSlotsOrNull(merged);
}
