/**
 * P6 后台 Curator：定时整理学习并按 A/B 显著性自动晋级。
 */
import { getRagAgentEnv } from "./rag_agent_env";
import { runRagLearningCurator, type RagCuratorReport } from "./learning_curator";

let started = false;
let lastRunAt: string | null = null;
let lastReport: RagCuratorReport | null = null;

import { refreshRetrievalBanditFromMetrics } from "./retrieval_bandit";

export async function runScheduledCurator(): Promise<RagCuratorReport> {
  refreshRetrievalBanditFromMetrics();
  const report = await runRagLearningCurator({
    autoPromote: true,
    promoteFromAb: true,
  });
  lastRunAt = report.ts;
  lastReport = report;
  return report;
}

export function startRagCuratorScheduler() {
  const env = getRagAgentEnv();
  if (!env.enableAutoCuratorScheduler || started) return;
  started = true;

  const tick = () => {
    void runScheduledCurator().catch((e) => {
      console.warn("[RagCuratorScheduler] tick failed:", e);
    });
  };

  setTimeout(tick, Math.min(30_000, env.autoCuratorIntervalMs));
  setInterval(tick, env.autoCuratorIntervalMs);
}

export function getCuratorSchedulerStatus() {
  const env = getRagAgentEnv();
  return {
    enabled: env.enableAutoCuratorScheduler,
    intervalMs: env.autoCuratorIntervalMs,
    lastRunAt,
    lastPromotedCount: lastReport?.promotedHints?.length ?? 0,
    lastAbSignificant: lastReport?.abSignificance?.significant ?? false,
  };
}
