import { getLearningSummary, getRetrievalPreferences } from "../utils/rag_learning";
import { getRagQueryMetricCounters, readRecentRagMetrics } from "../utils/query_metrics";
import { getRagExperienceSummary } from "../utils/experience_vectors";
import { getPromptEvolutionSummary, listPromotablePatches } from "../utils/prompt_evolution";
import { getUserPreferencesSummary } from "../utils/user_preferences";
import { listEvolvedHints } from "../utils/rag_evolved_config";
import { getCrossAgentProfileSummary } from "../utils/cross_agent_profile";
import { getPromptAbSummary } from "../utils/prompt_ab_router";
import { analyzeAbSignificance } from "../utils/ab_significance";
import { getCuratorSchedulerStatus } from "../utils/curator_scheduler";
import { getSharedIdentitySummary } from "../utils/agent_identity";
import { getOidcIdentitySummary } from "../utils/oidc_identity";
import { getRetrievalBanditSummary } from "../utils/retrieval_bandit";
import { getRagAgentEnv } from "../utils/rag_agent_env";
import { getEmbeddingRerankStatus } from "../utils/embedding_rerank";
import { getOnnxRerankStatus } from "../utils/onnx_rerank";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export default defineEventHandler(async () => {
  const learning = getLearningSummary();
  const prefs = getRetrievalPreferences();
  const evolution = getPromptEvolutionSummary();

  let evalBaseline: { passRate?: number; at?: string } | null = null;
  const evalFile = join(process.cwd(), ".data", "rag-eval-baseline.json");
  if (existsSync(evalFile)) {
    try {
      const o = JSON.parse(readFileSync(evalFile, "utf8"));
      evalBaseline = { passRate: o?.passRate, at: o?.at };
    } catch {
      evalBaseline = null;
    }
  }

  return {
    ok: true,
    learning,
    experience: getRagExperienceSummary(),
    promptEvolution: evolution,
    promptAb: getPromptAbSummary(),
    abSignificance: analyzeAbSignificance(),
    autoCurator: getCuratorSchedulerStatus(),
    sharedIdentity: getSharedIdentitySummary(),
    oidc: getOidcIdentitySummary(),
    retrievalBandit: getRetrievalBanditSummary(),
    dedicatedRerank: {
      enabled: getRagAgentEnv().enableDedicatedRerank,
      urlConfigured: Boolean(getRagAgentEnv().dedicatedRerankUrl),
      model: getRagAgentEnv().dedicatedRerankModel,
    },
    localRerank: { enabled: getRagAgentEnv().enableLocalRerank },
    embeddingRerank: getEmbeddingRerankStatus(),
    onnxRerank: getOnnxRerankStatus(),
    crossAgent: getCrossAgentProfileSummary(),
    evolvedHints: listEvolvedHints().slice(0, 12),
    promotablePatches: listPromotablePatches().slice(0, 8),
    userPreferences: getUserPreferencesSummary(),
    evalBaseline,
    preferences: {
      boostedSources: Object.keys(prefs.sourceBoosts).slice(0, 12),
      penalizedSources: Object.keys(prefs.sourcePenalties).slice(0, 8),
    },
    metrics: {
      counters: getRagQueryMetricCounters(),
      recent: readRecentRagMetrics(20),
    },
  };
});
