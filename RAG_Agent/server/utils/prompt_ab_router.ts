/**
 * P5 A/B：晋级补丁 treatment vs 仅影子补丁 control。
 */
import { getRagAgentEnv } from "./rag_agent_env";

export type PromptAbVariant = "control" | "treatment";

const counters: Record<string, number> = {};

function hashBucket(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % 100;
}

export function resolvePromptAbVariant(userKey: string | undefined, question: string): PromptAbVariant {
  const env = getRagAgentEnv();
  if (!env.enablePromptAbTest) return "treatment";
  const seed = `${userKey || "anon"}|${String(question ?? "").slice(0, 120)}`;
  const bucket = hashBucket(seed);
  return bucket < env.promptAbTreatmentPercent ? "treatment" : "control";
}

export function recordPromptAbObservation(variant: PromptAbVariant, ok: boolean) {
  const k = `${variant}:${ok ? "ok" : "fail"}`;
  counters[k] = (counters[k] || 0) + 1;
}

export function getPromptAbSummary() {
  const env = getRagAgentEnv();
  return {
    enabled: env.enablePromptAbTest,
    treatmentPercent: env.promptAbTreatmentPercent,
    counters: { ...counters },
  };
}
