import type { QueryPlan } from "./query_plan";
import { DB_AGENT_DEFAULTS } from "../db_agent_env";

function normalizeLoose(text: string) {
  return String(text ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function isLikelyChineseName(text: string) {
  const t = String(text ?? "").trim();
  if (!t || t.length < 2 || t.length > 6) return false;
  for (const ch of t) {
    const code = ch.charCodeAt(0);
    if (!(code >= 0x4e00 && code <= 0x9fff)) return false;
  }
  return true;
}

/** 是否为「某某的……」式明确人员归属问法（用于业务校验、路由等）。 */
export function hasExplicitOwnerQuestion(question: string) {
  const q = normalizeLoose(question);
  const idx = q.indexOf("的");
  if (idx <= 0) return false;
  const head = q.slice(0, idx).trim();
  return isLikelyChineseName(head);
}

function hasExplicitOwner(question: string) {
  return hasExplicitOwnerQuestion(question);
}

function hasExplicitIdentifierConstraint(question: string) {
  const q = normalizeLoose(question);
  if (!q) return false;
  // 通用“编号/ID/code + 值”模式，避免绑定具体业务词。
  const labeledId =
    /(编号|id|ID|Id|code|编码|单号|号)\s*(为|=|:|：)?\s*([A-Za-z0-9][A-Za-z0-9_-]{2,})/.test(q);
  if (labeledId) return true;
  // 常见业务编号形态（如 PM-2026040902 / ABC_00123）。
  const tokenLikeId = /\b[A-Za-z]{1,8}[-_][A-Za-z0-9_-]{3,}\b/.test(q);
  if (tokenLikeId) return true;
  return false;
}

/** 从 QueryPlan 读取人员姓名（优先，无问句 regex） */
export function extractNameCandidatesFromPlan(plan?: QueryPlan | null): string[] {
  if (!plan) return [];
  return (plan.entities?.names ?? [])
    .map((n) => String(n ?? "").trim())
    .filter((n) => n.length >= 2)
    .slice(0, 3);
}

/** plan 优先，问句仅作「X的…」/ 短句人名兜底 */
export function resolveNameCandidates(plan?: QueryPlan | null, question?: string): string[] {
  const fromPlan = extractNameCandidatesFromPlan(plan);
  if (fromPlan.length) return fromPlan;
  return extractNameCandidatesFromQuestion(question ?? "");
}

export function extractNameCandidatesFromQuestion(question: string) {
  const q = normalizeLoose(question);
  if (!q) return [];
  const explicit: string[] = [];
  const ofIdx = q.indexOf("的");
  if (ofIdx > 0) {
    const head = q.slice(0, ofIdx).trim();
    if (isLikelyChineseName(head)) explicit.push(head);
  }
  const compact = q.replace(/\s+/g, "");
  if (compact.length >= 2 && compact.length <= 6 && isLikelyChineseName(compact)) {
    explicit.push(compact);
  }
  return Array.from(new Set(explicit.filter(Boolean))).slice(0, 3);
}

export function shouldClarifyBeforeExecution(
  plan: QueryPlan,
  question: string,
): { needed: boolean; question: string; reason?: string } {
  const q = normalizeLoose(question);
  const textNames = resolveNameCandidates(plan, question);
  const explicitOwner = hasExplicitOwner(question);
  const explicitId = hasExplicitIdentifierConstraint(question);
  const hasEntitySignal = Boolean(
    explicitOwner ||
      explicitId ||
      textNames.length > 0 ||
      plan.entities.names.length > 0 ||
      plan.entities.ids.length > 0 ||
      (plan.entities.locations?.length ?? 0) > 0,
  );
  const hasFilterSignal = Boolean(plan.filters.where.length || plan.filters.time_range.relative || plan.filters.time_range.start);
  const hasAnalysisSignal = Boolean(plan.metrics.length || plan.dimensions.length);
  const hasAnyStrongSignal = hasEntitySignal || hasFilterSignal || hasAnalysisSignal;
  const tooVague = q.length <= 12 && !hasAnyStrongSignal;
  const threshold = DB_AGENT_DEFAULTS.clarificationConfidenceThreshold;

  if (DB_AGENT_DEFAULTS.enableClarificationLoop && plan.needs_clarification) {
    const cq = String(plan.clarification_question || "").trim();
    if (cq) {
      const lowConfidence = plan.confidence > 0 && plan.confidence < threshold;
      const hasMissingSlots = plan.missing_slots.length > 0;
      if (lowConfidence || hasMissingSlots || tooVague) {
        return { needed: true, question: cq, reason: "plan_needs_clarification" };
      }
      if (!hasAnyStrongSignal) {
        return { needed: true, question: cq, reason: "plan_needs_clarification" };
      }
    }
  }

  if (plan.needs_clarification) {
    if (hasAnyStrongSignal && plan.confidence >= threshold) return { needed: false, question: "" };
    if (!tooVague && hasAnyStrongSignal) return { needed: false, question: "" };
    return {
      needed: true,
      question:
        plan.clarification_question ||
        "为保证查询准确，请补充一个关键条件（如时间范围、查询对象或统计口径）。",
      reason: "vague_question",
    };
  }
  if (plan.intent === "aggregation" || plan.intent === "trend" || plan.intent === "comparison") {
    if (!plan.metrics.length && !plan.dimensions.length && tooVague) {
      return { needed: true, question: "你要统计的指标是什么？例如人数、次数或平均值。" };
    }
  }
  if (plan.intent === "detail") {
    if (hasEntitySignal || hasFilterSignal) return { needed: false, question: "" };
    if (tooVague) {
      return { needed: true, question: "你想查哪一类对象的明细？请补充对象或筛选条件（如姓名、时间范围）。" };
    }
  }
  return { needed: false, question: "" };
}
