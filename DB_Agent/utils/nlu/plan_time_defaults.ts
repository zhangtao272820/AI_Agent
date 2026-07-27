/**
 * 补丁 default_time_range.json → QueryPlan.filters.time_range（P6 默认口径）。
 */
import type { QueryPlan } from "./query_plan";
import { loadDomainPatch } from "../domain_patch";

export function enrichPlanWithPatchTimeDefaults(question: string, plan: QueryPlan): QueryPlan {
  const tr = plan.filters?.time_range;
  if (tr?.relative?.trim() || tr?.start?.trim() || tr?.end?.trim()) return plan;

  const blob = String(question ?? "").replace(/\s+/g, "");
  if (!blob) return plan;

  const ranges = loadDomainPatch().defaultTimeRanges;
  const keys = Object.keys(ranges).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (!blob.includes(key)) continue;
    const cfg = ranges[key];
    const relative = String(cfg?.description ?? key).trim() || key;
    return {
      ...plan,
      filters: {
        ...plan.filters,
        time_range: { start: "", end: "", relative },
      },
    };
  }
  return plan;
}
