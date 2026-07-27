/**
 * P5 Curator：扫描学习信号、合并重复补丁/SQL 模板、自动晋级影子 prompt。
 */
import { DB_AGENT_DEFAULTS } from "./db_agent_env";
import {
  autoPromoteEligiblePatches,
  autoPromoteEligiblePatchesVerified,
  getPromptEvolutionSummary,
  listPromptPatches,
} from "./prompt_evolution";
import { dedupeSqlTemplates, getSqlTemplateSummary } from "./query_sql_templates";
import { getLearningSummary, readLearningSignals } from "./query_learning";
import { inferCausalFailureTag } from "./query_route_policy";
import { isPromoteVerifyRequired } from "#agent-shared/evolutionPromotePolicy";

export type CuratorReport = {
  ts: string;
  promotedHints: string[];
  verifyGate?: Awaited<ReturnType<typeof import("#agent-shared/evolutionVerify").verifyBeforePromote>>;
  templatesDeduped: { before: number; after: number };
  shadowPatches: number;
  promotableRemaining: number;
  topFailureTags: Array<{ tag: string; count: number }>;
  learning: ReturnType<typeof getLearningSummary>;
  sqlTemplates: ReturnType<typeof getSqlTemplateSummary>;
  evolution: ReturnType<typeof getPromptEvolutionSummary>;
};

function scanFailureTags() {
  const signals = readLearningSignals(600).filter((s) => s.empty || !s.ok);
  const counts = new Map<string, number>();
  for (const s of signals) {
    const tag =
      inferCausalFailureTag({
        path: s.path,
        data_domain: s.data_domain,
        tables: s.tables,
        empty: Boolean(s.empty),
        reason: s.reason,
      }) || s.reason || "unknown";
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

export async function runLearningCurator(opts?: { autoPromote?: boolean; minHits?: number }): Promise<CuratorReport> {
  const minHits = opts?.minHits ?? DB_AGENT_DEFAULTS.promptPromoteMinHits;
  let promotedHints: string[] = [];
  let verifyGate: CuratorReport["verifyGate"];
  if (opts?.autoPromote !== false) {
    const verified = await autoPromoteEligiblePatchesVerified(minHits);
    promotedHints = verified.promoted;
    verifyGate = verified.verify;
  }
  const templatesDeduped = dedupeSqlTemplates();

  return {
    ts: new Date().toISOString(),
    promotedHints,
    verifyGate,
    templatesDeduped,
    shadowPatches: listPromptPatches().filter((p) => !p.promotedAt).length,
    promotableRemaining: getPromptEvolutionSummary().promotableCount,
    topFailureTags: scanFailureTags(),
    learning: getLearningSummary(),
    sqlTemplates: getSqlTemplateSummary(),
    evolution: getPromptEvolutionSummary(),
  };
}

export function runLearningCuratorSync(opts?: { autoPromote?: boolean; minHits?: number }): CuratorReport {
  const minHits = opts?.minHits ?? DB_AGENT_DEFAULTS.promptPromoteMinHits;
  const promotedHints =
    opts?.autoPromote === false || isPromoteVerifyRequired()
      ? []
      : autoPromoteEligiblePatches(minHits);
  const templatesDeduped = dedupeSqlTemplates();
  return {
    ts: new Date().toISOString(),
    promotedHints,
    templatesDeduped,
    shadowPatches: listPromptPatches().filter((p) => !p.promotedAt).length,
    promotableRemaining: getPromptEvolutionSummary().promotableCount,
    topFailureTags: scanFailureTags(),
    learning: getLearningSummary(),
    sqlTemplates: getSqlTemplateSummary(),
    evolution: getPromptEvolutionSummary(),
  };
}

export function runLightweightCuratorOnQueryEnd() {
  if (!DB_AGENT_DEFAULTS.enableAutoCurateOnQuery) return;
  try {
    if (isPromoteVerifyRequired()) {
      void autoPromoteEligiblePatchesVerified().then(() => undefined).catch(() => undefined);
    } else {
      autoPromoteEligiblePatches();
    }
    dedupeSqlTemplates();
  } catch {
    /* ignore */
  }
}
