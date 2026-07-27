import { dispatchArtifactRevokeToSubAgents, confirmRunArtifacts } from "#agent-shared/artifactFeedbackOrchestrator";

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
    return { ok: true, action, promoted: res.promoted };
  }

  const res = await dispatchArtifactRevokeToSubAgents(runId, artifact);
  return { ok: true, action, revoked: res.revoked };
});
