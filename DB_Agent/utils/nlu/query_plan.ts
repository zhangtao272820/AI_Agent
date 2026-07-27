export type QueryPlan = {
  intent: "detail" | "aggregation" | "trend" | "comparison" | "schema_help" | "out_of_scope" | "unknown";
  subject: "person" | "device" | "record" | "org" | "unknown";
  /** 模型判断的数据域：人员基础信息 vs 个人健康指标 */
  data_domain: "person_basic" | "person_health" | "general";
  entities: { names: string[]; locations: string[]; orgs: string[]; ids: string[] };
  metrics: string[];
  dimensions: string[];
  filters: {
    time_range: { start: string; end: string; relative: string };
    where: string[];
    /** Stage-2 槽位：LLM 产出的结构化筛选（含 sql_match_value 供 Schema Linking） */
    slots: { field_hint: string; value: string; sql_match_value: string }[];
  };
  sort: { field: string; direction: "asc" | "desc" }[];
  limit: number;
  confidence: number;
  missing_slots: string[];
  needs_clarification: boolean;
  clarification_question: string;
};

export function defaultQueryPlan(): QueryPlan {
  return {
    intent: "unknown",
    subject: "unknown",
    data_domain: "general",
    entities: { names: [], locations: [], orgs: [], ids: [] },
    metrics: [],
    dimensions: [],
    filters: { time_range: { start: "", end: "", relative: "" }, where: [], slots: [] },
    sort: [],
    limit: 20,
    confidence: 0,
    missing_slots: [],
    needs_clarification: false,
    clarification_question: "",
  };
}

export function parseQueryPlan(raw: unknown): QueryPlan {
  const d = defaultQueryPlan();
  const text = String(raw ?? "").trim();
  if (!text) return d;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return d;
  let obj: any = null;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return d;
  }
  const intentSet = new Set(["detail", "aggregation", "trend", "comparison", "schema_help", "out_of_scope", "unknown"]);
  const subjectSet = new Set(["person", "device", "record", "org", "unknown"]);
  const domainSet = new Set(["person_basic", "person_health", "general"]);
  const intent = intentSet.has(String(obj?.intent)) ? obj.intent : d.intent;
  const subject = subjectSet.has(String(obj?.subject)) ? obj.subject : d.subject;
  const data_domain = domainSet.has(String(obj?.data_domain)) ? obj.data_domain : d.data_domain;
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
  const timeRange = obj?.filters?.time_range ?? {};
  const sortRaw = Array.isArray(obj?.sort) ? obj.sort : [];
  const sort = sortRaw
    .map((s: any) => ({
      field: String(s?.field ?? "").trim(),
      direction: String(s?.direction ?? "").toLowerCase() === "asc" ? "asc" : "desc",
    }))
    .filter((s: any) => s.field) as { field: string; direction: "asc" | "desc" }[];
  const limit = Number(obj?.limit);
  const confidence = Number(obj?.confidence);
  const slotRaw = Array.isArray(obj?.filters?.slots) ? obj.filters.slots : [];
  const slots = slotRaw
    .map((s: any) => ({
      field_hint: String(s?.field_hint ?? "").trim(),
      value: String(s?.value ?? "").trim(),
      sql_match_value: String(s?.sql_match_value ?? s?.value ?? "").trim(),
    }))
    .filter((s: { field_hint: string; value: string }) => s.field_hint || s.value)
    .slice(0, 12);
  return {
    intent,
    subject,
    data_domain,
    entities: {
      names: arr(obj?.entities?.names),
      locations: arr(obj?.entities?.locations),
      orgs: arr(obj?.entities?.orgs),
      ids: arr(obj?.entities?.ids),
    },
    metrics: arr(obj?.metrics),
    dimensions: arr(obj?.dimensions),
    filters: {
      time_range: {
        start: String(timeRange?.start ?? "").trim(),
        end: String(timeRange?.end ?? "").trim(),
        relative: String(timeRange?.relative ?? "").trim(),
      },
      where: arr(obj?.filters?.where),
      slots,
    },
    sort,
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    missing_slots: arr(obj?.missing_slots),
    needs_clarification: Boolean(obj?.needs_clarification),
    clarification_question: String(obj?.clarification_question ?? "").trim(),
  };
}

export function inferIntentFromPlan(plan: QueryPlan): string {
  if (plan.intent === "schema_help") return "sql_agent";
  if (plan.intent === "out_of_scope") return "out_of_scope";
  if (plan.intent === "aggregation" || plan.intent === "trend" || plan.intent === "comparison") return "statistics";
  const footMetrics = (plan.metrics ?? []).some((m) => /足底|足压|压力测试|平衡|步态|活动检测/.test(m));
  if (footMetrics || plan.data_domain === "general") {
    if (plan.intent === "detail") return "sql_agent";
  }
  if (plan.intent === "detail") {
    if (plan.data_domain === "person_health") return "person_health";
    if (plan.subject === "person" || plan.data_domain === "person_basic") return "person_info";
    return "sql_agent";
  }
  if (plan.data_domain === "person_health") return "person_health";
  return "sql_agent";
}

/** 将查询计划压成一段给 SQL Agent 用的中文约束（不向用户展示）。 */
export function formatQueryPlanForSqlAgent(plan: QueryPlan | null | undefined): string {
  if (!plan) return "";
  const tr = plan.filters?.time_range ?? { start: "", end: "", relative: "" };
  const hasBody =
    plan.intent !== "unknown" ||
    plan.entities.names.length > 0 ||
    plan.entities.locations.length > 0 ||
    plan.entities.orgs.length > 0 ||
    plan.entities.ids.length > 0 ||
    plan.metrics.length > 0 ||
    plan.dimensions.length > 0 ||
    (plan.filters?.where?.length ?? 0) > 0 ||
    String(tr.relative || tr.start || tr.end).trim() !== "" ||
    plan.sort.length > 0;
  if (!hasBody && plan.confidence < 0.25) return "";

  const intentZh: Record<QueryPlan["intent"], string> = {
    detail: "明细/列表",
    aggregation: "统计/汇总",
    trend: "趋势",
    comparison: "对比",
    schema_help: "表结构/字段说明",
    out_of_scope: "超出当前库范围",
    unknown: "未分类",
  };
  const subjectZh: Record<QueryPlan["subject"], string> = {
    person: "人员",
    device: "设备",
    record: "业务记录",
    org: "机构",
    unknown: "未指定",
  };

  const lines: string[] = [];
  lines.push("[查询计划]（仅用于生成 SQL 与选表；请勿向用户复述本段原文）");
  lines.push(`- 意图：${intentZh[plan.intent] ?? plan.intent}`);
  lines.push(`- 主体：${subjectZh[plan.subject] ?? plan.subject}`);
  if (plan.data_domain === "person_health") lines.push(`- 数据域：个人健康指标/体检/健康记录（须 JOIN 健康明细表，勿只查人员基础表）`);
  else if (plan.data_domain === "person_basic") lines.push(`- 数据域：人员基本信息`);
  if (plan.entities.names.length) lines.push(`- 姓名/专有名词：${plan.entities.names.join("、")}`);
  if (plan.entities.locations.length) lines.push(`- 地点：${plan.entities.locations.join("、")}`);
  if (plan.entities.orgs.length) lines.push(`- 机构：${plan.entities.orgs.join("、")}`);
  if (plan.entities.ids.length) lines.push(`- 编号类过滤（不要在最终回复中暴露原始编号）：${plan.entities.ids.join("、")}`);
  if (plan.metrics.length) lines.push(`- 指标：${plan.metrics.join("、")}`);
  if (plan.dimensions.length) lines.push(`- 维度：${plan.dimensions.join("、")}`);
  const timeBits: string[] = [];
  if (String(tr.relative || "").trim()) timeBits.push(`相对：${String(tr.relative).trim()}`);
  if (String(tr.start || "").trim() || String(tr.end || "").trim()) {
    timeBits.push(`区间：${String(tr.start || "").trim() || "?"} ~ ${String(tr.end || "").trim() || "?"}`);
  }
  if (timeBits.length) lines.push(`- 时间：${timeBits.join("；")}`);
  if (plan.filters.where.length) lines.push(`- 过滤要点：${plan.filters.where.join("；")}`);
  if (plan.filters.slots?.length) {
    lines.push(
      `- 结构化筛选：${plan.filters.slots.map((s) => `${s.field_hint}→${s.sql_match_value || s.value}`).join("；")}`,
    );
  }
  if (plan.sort.length) {
    lines.push(`- 排序：${plan.sort.map((s) => `${s.field} ${s.direction.toUpperCase()}`).join("，")}`);
  }
  if (Number.isFinite(plan.limit) && plan.limit > 0) lines.push(`- 建议结果行数上限：${plan.limit}`);
  if (plan.confidence > 0) lines.push(`- 计划置信度：${plan.confidence.toFixed(2)}`);

  const out = lines.join("\n");
  return out.length > 1400 ? `${out.slice(0, 1400)}…` : out;
}

/** 把计划里的统计相关词拼到问题后，供 statisticsTool 的正则匹配（不改变用户可见问句，仅内部检索用）。 */
export function appendPlanKeywordsForStatisticsMatch(question: string, plan: QueryPlan | null | undefined): string {
  const q = String(question ?? "").trim();
  if (!plan) return q;
  if (plan.intent !== "aggregation" && plan.intent !== "trend" && plan.intent !== "comparison") return q;
  const extra: string[] = [];
  if (plan.intent === "trend") extra.push("趋势", "变化");
  if (plan.intent === "aggregation" || plan.intent === "comparison") extra.push("分布", "占比", "结构");
  for (const d of plan.dimensions.slice(0, 8)) {
    const s = String(d ?? "").trim();
    if (s) extra.push(s);
  }
  for (const m of plan.metrics.slice(0, 6)) {
    const s = String(m ?? "").trim();
    if (s) extra.push(s);
  }
  const rel = String(plan.filters?.time_range?.relative ?? "").trim();
  if (rel) extra.push(rel);
  if (!extra.length) return q;
  const merged = `${q} ${extra.join(" ")}`.trim();
  return merged.length > 800 ? `${merged.slice(0, 800)}…` : merged;
}
