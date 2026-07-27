import type { RunMeta } from "./types";

export function pct(v?: number) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

export function pathLabel(p?: string) {
  const map: Record<string, string> = {
    sql_direct: "结构化查询",
    sql_agent: "深度分析",
    person_health: "健康档案",
    person_info: "人员信息",
    statistics: "统计分析",
    generic_stats: "统计分析",
    clarify: "等待补充条件",
    task_stack: "多步查询",
    other: "常规查询",
  };
  return map[String(p || "")] || "常规查询";
}

const TIER_HINT: Record<string, string> = {
  L1: "简单明细",
  L2: "单表多条件",
  L3: "多表关联",
  L4: "聚合统计",
  L5: "多条件关联",
  L6: "对比/TopN",
  L7: "子查询",
  L8: "续问",
  L9: "需澄清",
};

export function tierLabel(tier?: string) {
  if (!tier) return "";
  const hint = TIER_HINT[tier];
  return hint ? `${tier} · ${hint}` : tier;
}

function tierLevel(tier?: string) {
  const m = String(tier || "").match(/^L(\d+)$/i);
  return m ? Number(m[1]) : 0;
}

export function isFastReuseMeta(meta: RunMeta) {
  return Boolean(meta.sql_template_direct || meta.sql_plan_direct || meta.structural_plan_used);
}

export function isComplexMeta(meta: RunMeta) {
  if (meta.path !== "sql_direct") return false;
  if (tierLevel(meta.query_tier) >= 3) return true;
  return meta.llm_calls != null && meta.llm_calls >= 8;
}

export function primaryPathLabel(meta: RunMeta) {
  const path = String(meta.path || "");
  if (meta.agent_fallback || path === "sql_agent") return "深度分析";
  if (isFastReuseMeta(meta)) return "快速复用";
  if (path === "sql_direct") return isComplexMeta(meta) ? "复杂查询" : "结构化查询";
  return pathLabel(path);
}

export function primaryBadgeClass(meta: RunMeta) {
  if (isFastReuseMeta(meta)) return "run-meta-badge-fast";
  if (meta.agent_fallback || meta.path === "sql_agent") return "run-meta-badge-warn";
  if (isComplexMeta(meta)) return "run-meta-badge-complex";
  return "";
}

export function domainLabel(d?: string) {
  const map: Record<string, string> = {
    person_health: "健康体征",
    person_basic: "基础档案",
    general: "",
  };
  return map[String(d || "")] || "";
}

export function profileLabel(p?: string) {
  const map: Record<string, string> = {
    low_token: "省 token",
    balanced: "均衡",
    full: "全功能",
  };
  return map[String(p || "")] || String(p || "—");
}
