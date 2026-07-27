/**
 * P6+ 澄清快捷选项：按 missing_slots 结构性映射，可选 LLM 补充。
 */
import type { DbRunMeta } from "./query_metrics";

const SLOT_CHIPS: Record<string, string[]> = {
  time_range: ["最近一周", "最近一个月", "最近三个月", "今年"],
  time: ["最近一周", "最近一个月", "最近三个月", "今年"],
  entity: ["张三的健康记录", "查询全部老人", "按姓名查询"],
  subject: ["张三的健康记录", "查询全部老人", "按姓名查询"],
  name: ["张三的健康记录", "查询全部老人", "按姓名查询"],
  metric: ["统计人数", "统计次数", "平均值", "分布占比"],
  dimension: ["统计人数", "统计次数", "平均值", "分布占比"],
  field: ["统计人数", "统计次数", "平均值", "分布占比"],
};

const DEFAULT_CHIPS = ["最近一个月", "张三的健康记录", "统计人数"];

/** 按 missing_slots 映射，不用问句关键词正则 */
export function buildClarificationSuggestions(input: {
  clarificationQuestion?: string;
  missingSlots?: string[];
  lastUserQuestion?: string;
}): string[] {
  const slots = (input.missingSlots ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const out: string[] = [];

  for (const slot of slots) {
    const key = Object.keys(SLOT_CHIPS).find((k) => slot.includes(k) || k.includes(slot));
    if (key) out.push(...(SLOT_CHIPS[key] ?? []));
  }

  if (!out.length) out.push(...DEFAULT_CHIPS);

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const item of out) {
    if (seen.has(item)) continue;
    seen.add(item);
    deduped.push(item);
  }
  return deduped.slice(0, 6);
}

export function mergeClarificationReply(baseQuestion: string, chip: string): string {
  const base = String(baseQuestion ?? "").trim();
  const pick = String(chip ?? "").trim();
  if (!pick) return base;
  if (!base || base.length <= 4) return pick;
  if (pick.startsWith("最近") || pick === "今年" || pick === "本月") {
    return `${base}，时间范围：${pick}`;
  }
  return `${base}，${pick}`;
}

export function suggestionsFromRunMeta(meta: Partial<DbRunMeta> | null | undefined, lastQuestion?: string) {
  if (!meta?.needs_clarification) return [];
  return buildClarificationSuggestions({
    clarificationQuestion: meta.clarification_question,
    missingSlots: meta.missing_slots,
    lastUserQuestion: lastQuestion,
  });
}
