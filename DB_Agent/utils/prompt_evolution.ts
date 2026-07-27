/**
 * Prompt 影子进化：从失败/负反馈沉淀短提示补丁，注入 SQL/Plan 阶段（默认 shadow，不覆盖主 prompt）。
 * P5：hits 达阈值后可晋级到 .data/db-blueprint.evolved.json。
 * 收敛期：仅进化 SQL/规划措辞（EVO_AGENT_PROMPT_EXECUTION_ONLY）；不修改路由/表选择权威。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clipText } from "./nlu/text";
import { appendEvolvedBlueprintHint, listEvolvedHints } from "./blueprint_config";
import { DB_AGENT_DEFAULTS } from "./db_agent_env";
import { verifyBeforePromote } from "#agent-shared/evolutionVerify";
import { promoteEvoPolicy, writeEvoShadowPolicy } from "#agent-shared/evoPolicyStore";
import { isAgentEvolutionStageAllowed, isPromoteVerifyRequired } from "#agent-shared/evolutionPromotePolicy";

export type PromptPatch = {
  id: string;
  ts: string;
  stage: "plan" | "preflight" | "sql";
  text: string;
  source: "reflection" | "feedback" | "empty_result";
  hits: number;
  promotedAt?: string;
  promotedHintId?: string;
};

type PatchStore = { patches: PromptPatch[] };

function patchFile() {
  const dir = join(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "db-prompt-patches.shadow.json");
}

function loadStore(): PatchStore {
  const p = patchFile();
  if (!existsSync(p)) return { patches: [] };
  try {
    const o = JSON.parse(readFileSync(p, "utf8")) as PatchStore;
    return { patches: Array.isArray(o?.patches) ? o.patches : [] };
  } catch {
    return { patches: [] };
  }
}

function saveStore(store: PatchStore) {
  const trimmed = { patches: store.patches.slice(-40) };
  writeFileSync(patchFile(), JSON.stringify(trimmed, null, 2), "utf8");
}

const STAGE_SCOPE: Record<PromptPatch["stage"], string> = {
  plan: "查询规划阶段（从失败/反馈进化）",
  preflight: "SQL 编排阶段（从失败/反馈进化）",
  sql: "SQL 生成阶段（从失败/反馈进化）",
};

export function appendPromptPatch(input: {
  stage: PromptPatch["stage"];
  text: string;
  source: PromptPatch["source"];
}) {
  if (!isAgentEvolutionStageAllowed("db", input.stage)) return;
  const t = clipText(String(input.text ?? "").trim(), 200);
  if (!t) return;
  const store = loadStore();
  const dup = store.patches.find(
    (p) => !p.promotedAt && p.stage === input.stage && p.text === t,
  );
  if (dup) {
    dup.hits += 1;
    dup.ts = new Date().toISOString();
  } else {
    store.patches.push({
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      stage: input.stage,
      text: t,
      source: input.source,
      hits: 1,
    });
  }
  saveStore(store);
  void writeEvoShadowPolicy("db", input.stage, { text: t, source: input.source, hits: dup?.hits ?? 1 }).catch(() => undefined);
}

export function getPromptPatchesForStage(stage: PromptPatch["stage"], max = 4): string {
  const store = loadStore();
  const evolved = listEvolvedHints().filter((h) => h.stage === stage);
  const shadow = store.patches
    .filter((p) => !p.promotedAt && p.stage === stage)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, max);
  const lines: string[] = [];
  for (const h of evolved.slice(0, 2)) {
    lines.push(`- [已晋级] ${h.text}`);
  }
  for (const p of shadow) {
    lines.push(`- ${p.text}`);
  }
  if (!lines.length) return "";
  return clipText(`[进化提示·${stage}]\n${lines.join("\n")}`, 500);
}

export function listPromptPatches() {
  return loadStore().patches;
}

export function listPromotablePatches(minHits: number = DB_AGENT_DEFAULTS.promptPromoteMinHits) {
  return loadStore().patches.filter((p) => !p.promotedAt && p.hits >= minHits);
}

export function promotePromptPatch(
  patchId: string,
): { ok: true; hintId: string } | { ok: false; reason: string } {
  const store = loadStore();
  const patch = store.patches.find((p) => p.id === patchId);
  if (!patch) return { ok: false, reason: "patch_not_found" };
  if (patch.promotedAt) return { ok: false, reason: "already_promoted" };

  const hintId = `evolved_${patch.stage}_${patch.id.slice(-8)}`;
  appendEvolvedBlueprintHint({
    id: hintId,
    scope: STAGE_SCOPE[patch.stage],
    text: patch.text,
    stage: patch.stage,
    sourcePatchId: patch.id,
  });

  patch.promotedAt = new Date().toISOString();
  patch.promotedHintId = hintId;
  saveStore(store);
  return { ok: true, hintId };
}

export async function promotePromptPatchVerified(
  patchId: string,
): Promise<{ ok: true; hintId: string } | { ok: false; reason: string }> {
  const verify = await verifyBeforePromote("db");
  if (!verify.ok) return { ok: false, reason: `verify_failed:${verify.reason || verify.gate}` };

  const store = loadStore();
  const patch = store.patches.find((p) => p.id === patchId);
  if (!patch) return { ok: false, reason: "patch_not_found" };
  if (patch.promotedAt) return { ok: false, reason: "already_promoted" };

  const hintId = `evolved_${patch.stage}_${patch.id.slice(-8)}`;
  appendEvolvedBlueprintHint({
    id: hintId,
    scope: STAGE_SCOPE[patch.stage],
    text: patch.text,
    stage: patch.stage,
    sourcePatchId: patch.id,
  });

  patch.promotedAt = new Date().toISOString();
  patch.promotedHintId = hintId;
  saveStore(store);

  await promoteEvoPolicy("db", patch.stage, {
    verifyOk: true,
    shadowPayload: { hintId, text: patch.text, stage: patch.stage, sourcePatchId: patch.id },
  }).catch(() => undefined);

  return { ok: true, hintId };
}

export function autoPromoteEligiblePatches(minHits: number = DB_AGENT_DEFAULTS.promptPromoteMinHits) {
  if (isPromoteVerifyRequired()) return [] as string[];
  const eligible = listPromotablePatches(minHits);
  const promoted: string[] = [];
  for (const p of eligible) {
    const res = promotePromptPatch(p.id);
    if (res.ok) promoted.push(res.hintId);
  }
  return promoted;
}

export async function autoPromoteEligiblePatchesVerified(minHits: number = DB_AGENT_DEFAULTS.promptPromoteMinHits) {
  const verify = await verifyBeforePromote("db");
  if (!verify.ok) return { promoted: [] as string[], verify };
  const eligible = listPromotablePatches(minHits);
  const promoted: string[] = [];
  for (const p of eligible) {
    const res = await promotePromptPatchVerified(p.id);
    if (res.ok) promoted.push(res.hintId);
  }
  return { promoted, verify };
}

export function getPromptEvolutionSummary() {
  const patches = listPromptPatches();
  const minHits = DB_AGENT_DEFAULTS.promptPromoteMinHits;
  return {
    shadowCount: patches.filter((p) => !p.promotedAt).length,
    promotedCount: patches.filter((p) => p.promotedAt).length,
    evolvedHintCount: listEvolvedHints().length,
    promotableCount: listPromotablePatches(minHits).length,
    promoteMinHits: minHits,
  };
}

export function clearPromptPatches() {
  saveStore({ patches: [] });
}
