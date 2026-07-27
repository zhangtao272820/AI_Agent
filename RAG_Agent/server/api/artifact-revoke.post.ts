import { confirmRunArtifacts, dispatchArtifactRevokeToSubAgents } from "#agent-shared/artifactFeedbackOrchestrator";
import { normalizeArtifact } from "#agent-shared/artifactFeedbackPolicy";
import { refreshArtifactPrefsCache } from "../utils/rag_learning";

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    run_id?: string;
    runId?: string;
    action?: "revoke" | "confirm";
    artifact?: Record<string, unknown>;
  }>(event);

  const runId = String(body?.run_id ?? body?.runId ?? "").trim();
  if (!runId) {
    throw createError({ statusCode: 400, statusMessage: "run_id 不能为空" });
  }
  const artifact = normalizeArtifact(body?.artifact);
  const action = body?.action === "confirm" ? "confirm" : "revoke";

  if (action === "confirm") {
    const res = await confirmRunArtifacts(runId, artifact);
    await refreshArtifactPrefsCache(true);
    return { ok: true, action, promoted: res.promoted };
  }

  const res = await dispatchArtifactRevokeToSubAgents(runId, artifact);
  await refreshArtifactPrefsCache(true);
  return { ok: true, action, revoked: res.revoked };
});
