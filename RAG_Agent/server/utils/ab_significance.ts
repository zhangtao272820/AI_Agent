/**
 * P6 A/B 显著性：从指标日志估计 treatment vs control，驱动自动晋级。
 */
import { readRecentRagMetrics } from "./query_metrics";
import { getRagAgentEnv } from "./rag_agent_env";

export type AbSignificanceReport = {
  enabled: boolean;
  treatmentN: number;
  controlN: number;
  treatmentOkRate: number;
  controlOkRate: number;
  delta: number;
  significant: boolean;
  minSamples: number;
  minDelta: number;
  reason: string;
};

export function analyzeAbSignificance(limit = 500): AbSignificanceReport {
  const env = getRagAgentEnv();
  const minSamples = env.abAutoPromoteMinSamples;
  const minDelta = env.abAutoPromoteMinDelta;

  if (!env.enablePromptAbTest) {
    return {
      enabled: false,
      treatmentN: 0,
      controlN: 0,
      treatmentOkRate: 0,
      controlOkRate: 0,
      delta: 0,
      significant: false,
      minSamples,
      minDelta,
      reason: "ab_disabled",
    };
  }

  const rows = readRecentRagMetrics(limit).filter(
    (r) => r.path === "document_query" && (r.ab_variant === "treatment" || r.ab_variant === "control")
  );

  let tOk = 0;
  let tN = 0;
  let cOk = 0;
  let cN = 0;

  for (const r of rows) {
    if (r.ab_variant === "treatment") {
      tN += 1;
      if (r.ok) tOk += 1;
    } else {
      cN += 1;
      if (r.ok) cOk += 1;
    }
  }

  const treatmentOkRate = tN ? tOk / tN : 0;
  const controlOkRate = cN ? cOk / cN : 0;
  const delta = treatmentOkRate - controlOkRate;

  let reason = "insufficient_samples";
  let significant = false;

  if (tN >= minSamples && cN >= minSamples) {
    if (delta >= minDelta) {
      significant = true;
      reason = "treatment_better";
    } else if (delta <= -minDelta) {
      reason = "control_better";
    } else {
      reason = "no_clear_winner";
    }
  }

  return {
    enabled: true,
    treatmentN: tN,
    controlN: cN,
    treatmentOkRate,
    controlOkRate,
    delta,
    significant,
    minSamples,
    minDelta,
    reason,
  };
}

export function shouldAutoPromoteFromAb(): boolean {
  const env = getRagAgentEnv();
  if (!env.enableAbAutoPromote) return false;
  return analyzeAbSignificance().significant;
}
