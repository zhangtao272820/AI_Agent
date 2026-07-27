/**
 * 总管 prefetch schema / query_plan 是否可信：模型审表集合是否服务当前问句。
 */
import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { incrementLlmCallCount } from "./llm_call_counter";
import type { ManagerDbTaskContext } from "./manager_task_context";
import { parseQueryPlan } from "./nlu/query_plan";
import { isAuthoritativeLlmTableJudge, parseSchemaGroundTableJudge } from "./prefetch_table_judge";

const TrustSchema = z.object({
  trust_prefetch: z.boolean(),
  trust_query_plan: z.boolean(),
  relevant_tables: z.array(z.string()).max(8).optional(),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional(),
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

export function isManagerPrefetchTrustLlmEnabled(): boolean {
  return String(process.env.DB_MANAGER_PREFETCH_TRUST_LLM ?? "1").trim() !== "0";
}

export type ManagerPrefetchTrust = {
  trustPrefetch: boolean;
  trustQueryPlan: boolean;
  confidence: number;
  rationale?: string;
  /** 与当前问句同任务的预取表子集（须 ⊆ 候选）；空表示不可信整包表线索 */
  relevantTables?: string[];
};

function collectPrefetchCandidateTables(mgr?: ManagerDbTaskContext | null): string[] {
  const fromHints = (mgr?.hint_tables ?? []).map((t) => String(t ?? "").trim()).filter(Boolean);
  const parsed = parseSchemaGroundTableJudge(mgr?.prefetch_schema_ground_json);
  const fromGround = parsed?.candidate_tables ?? [];
  return Array.from(new Set([...fromHints, ...fromGround])).slice(0, 8);
}

function filterRelevantTables(candidates: string[], picked: string[] | undefined): string[] {
  if (!picked?.length) return [];
  const allow = new Set(candidates);
  return picked.map((t) => String(t ?? "").trim()).filter((t) => t && allow.has(t)).slice(0, 6);
}

export async function judgeManagerPrefetchTrustByLlm(
  model: ChatOpenAI | null,
  standaloneQuestion: string,
  mgr?: ManagerDbTaskContext | null,
): Promise<ManagerPrefetchTrust> {
  const q = String(standaloneQuestion ?? "").trim();
  const tables = collectPrefetchCandidateTables(mgr);
  const hasPrefetch =
    Boolean(mgr?.prefetch_reuse) ||
    Boolean(mgr?.prefetch_schema_ground_json?.trim()) ||
    tables.length > 0;
  const hasPlan = Boolean(mgr?.query_plan_json?.trim());

  if (!mgr || mgr.source !== "manager" || !q) {
    return { trustPrefetch: false, trustQueryPlan: false, confidence: 0 };
  }
  if (!hasPrefetch && !hasPlan) {
    return { trustPrefetch: false, trustQueryPlan: false, confidence: 0.9, rationale: "no_manager_prefetch" };
  }

  // 文本重合≠表集合正确：有候选表时必须经模型审表，禁止 refined 短路 trustPrefetch
  if (!tables.length) {
    const refined = String(mgr.refined_question ?? "").trim();
    if (refined && refined.length >= 4) {
      const nq = q.replace(/\s+/g, "");
      const nr = refined.replace(/\s+/g, "");
      if (nq === nr || nq.includes(nr) || nr.includes(nq)) {
        const ratio = Math.min(nq.length, nr.length) / Math.max(nq.length, nr.length);
        if (ratio >= 0.55) {
          return {
            trustPrefetch: false,
            trustQueryPlan: hasPlan,
            confidence: 0.7,
            rationale: "refined_aligned_no_tables",
          };
        }
      }
    }
  }

  if (!model || !isManagerPrefetchTrustLlmEnabled()) {
    return { trustPrefetch: false, trustQueryPlan: false, confidence: 0.4, rationale: "llm_off" };
  }

  const plan = hasPlan ? parseQueryPlan(String(mgr.query_plan_json)) : null;
  const groundJudge = parseSchemaGroundTableJudge(mgr?.prefetch_schema_ground_json)?.table_judge;
  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是总管→DB 预取可信度判定器。判断预取表线索/query_plan 是否服务于当前 DB 问句。",
          "只输出 JSON。",
          "规则：",
          "- 逐表判断：relevant_tables 只保留与当前问句同一查数任务的表（必须 ⊆ 预取表）。",
          "- 若预取混入跨业务无关表，trust_prefetch 可为 true 但 relevant_tables 须去掉噪声；若多数无关则 trust_prefetch=false。",
          "- 若预取来自整句复合任务（含知识库/报告）而当前问句仅为 DB 子句 → trust_prefetch=false, trust_query_plan=false。",
          "- 若表名像知识库文档表（dify_knowledge、doc_segment）而问句是人口/业务库统计 → false。",
          "- 问句文本重合不能替代表相关性判断。",
          'schema: {"trust_prefetch":bool,"trust_query_plan":bool,"relevant_tables":[],"confidence":0-1,"rationale":string}',
        ].join("\n"),
      ],
      [
        "human",
        [
          `当前 DB 问句：${q.slice(0, 600)}`,
          String(mgr.refined_question ?? "").trim()
            ? `总管 refined：${String(mgr.refined_question).trim().slice(0, 400)}`
            : "",
          tables.length ? `预取候选表：${tables.join("、")}` : "预取候选表：（无）",
          groundJudge?.primary_tables?.length
            ? `预取声称主表：${groundJudge.primary_tables.join("、")}（source=${String((groundJudge as { judge_source?: string }).judge_source || groundJudge.reasoning || "")}）`
            : "",
          plan
            ? `query_plan intent=${plan.intent} locations=${(plan.entities?.locations ?? []).join("、")} metrics=${(plan.metrics ?? []).join("、")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ],
    ]);
    const parsed = TrustSchema.safeParse(
      safeJsonParse(String((res as { content?: string })?.content ?? "")),
    );
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.52) {
      return { trustPrefetch: false, trustQueryPlan: false, confidence: 0.45, rationale: "llm_low_confidence" };
    }
    const relevant = filterRelevantTables(tables, parsed.data.relevant_tables);
    const trustPrefetch =
      parsed.data.trust_prefetch === true &&
      hasPrefetch &&
      (tables.length === 0 || relevant.length > 0);
    return {
      trustPrefetch,
      trustQueryPlan: parsed.data.trust_query_plan === true && hasPlan,
      confidence: Number(parsed.data.confidence ?? 0.65),
      rationale: String(parsed.data.rationale ?? "").slice(0, 240) || undefined,
      relevantTables: relevant.length ? relevant : undefined,
    };
  } catch {
    return { trustPrefetch: false, trustQueryPlan: false, confidence: 0.3, rationale: "llm_error" };
  }
}

function filterSchemaGroundJsonToTables(raw: string | undefined, keep: string[]): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s || !keep.length) return undefined;
  try {
    const g = JSON.parse(s) as {
      candidate_tables?: string[];
      table_judge?: {
        ranked_tables?: string[];
        primary_tables?: string[];
        auxiliary_tables?: string[];
        reasoning?: string;
        sql_hint?: string;
        judge_source?: string;
      };
      [k: string]: unknown;
    };
    const keepSet = new Set(keep);
    g.candidate_tables = (g.candidate_tables ?? []).filter((t) => keepSet.has(String(t)));
    if (g.table_judge) {
      const ranked = (g.table_judge.ranked_tables ?? []).filter((t) => keepSet.has(String(t)));
      let primary = (g.table_judge.primary_tables ?? []).filter((t) => keepSet.has(String(t)));
      const auxiliary = (g.table_judge.auxiliary_tables ?? []).filter((t) => keepSet.has(String(t)));
      // 过滤后若不再是权威 LLM primary，去掉 judge，迫使执行期重选
      if (!primary.length || !isAuthoritativeLlmTableJudge({ ...g.table_judge, primary_tables: primary } as any)) {
        delete g.table_judge;
      } else {
        g.table_judge = {
          ...g.table_judge,
          ranked_tables: ranked.length ? ranked : keep,
          primary_tables: primary,
          auxiliary_tables: auxiliary,
        };
      }
    }
    return JSON.stringify(g);
  } catch {
    return undefined;
  }
}

/** 剥离不可信的总管预取侧车；按 relevant_tables 收窄候选 */
export function sanitizeUntrustedManagerTask(
  mgr: ManagerDbTaskContext | null | undefined,
  trust: ManagerPrefetchTrust,
): ManagerDbTaskContext | null | undefined {
  if (!mgr) return mgr;
  const out: ManagerDbTaskContext = { ...mgr };

  if (trust.trustPrefetch && trust.relevantTables?.length) {
    const keep = trust.relevantTables;
    out.hint_tables = keep;
    const filteredGround = filterSchemaGroundJsonToTables(out.prefetch_schema_ground_json, keep);
    if (filteredGround) {
      out.prefetch_schema_ground_json = filteredGround;
      const stillAuthoritative = isAuthoritativeLlmTableJudge(
        parseSchemaGroundTableJudge(filteredGround)?.table_judge,
      );
      out.prefetch_reuse = stillAuthoritative ? out.prefetch_reuse : undefined;
    }
    if (!trust.trustQueryPlan) out.query_plan_json = undefined;
    return out;
  }

  if (trust.trustPrefetch && trust.trustQueryPlan && !collectPrefetchCandidateTables(mgr).length) {
    return mgr;
  }

  if (!trust.trustPrefetch) {
    out.prefetch_reuse = undefined;
    out.prefetch_schema_ground_json = undefined;
    out.hint_tables = undefined;
    out.hint_fields = undefined;
    out.schema_fk_hints = undefined;
    // 表线索已剥离时同步去掉检索词，避免残留关键词二次污染探表
    out.schema_search_keywords = undefined;
  }
  if (!trust.trustQueryPlan) {
    out.query_plan_json = undefined;
  }
  return out;
}
