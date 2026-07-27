import { sanitizeIncomingQuestion, parseManagerRagTaskFromJson } from "../utils/incoming_question";
import { runDocumentRetrieval } from "../utils/document_retrieval";
import { resolveUserKeyFromRequest } from "../utils/user_preferences";
import { resolveAgentUserId, checkUserAccess } from "../utils/agent_identity";
import { buildRagAgentResult } from "../utils/agent_result";
import { appendAgentTraceLog } from "../utils/trace_log";
import { ensureInternalAgentAccess } from "../utils/internal_auth";
import { applyPlatformModelOverrides } from "../utils/platform_config";
import { isManagerOrchestratedRequest } from "../utils/manager_orchestration";
import { setOrchestratedByManager, setManagerRagTask, setRetrievalUserKey, clearRetrievalUserKey } from "../utils/retrieval_context";

/** 程序化检索（总管 prefetch / 旧版 retrieve-first）；用户与 UI 统一走 /api/chat → document_query */
export default defineEventHandler(async (event) => {
  ensureInternalAgentAccess(event);
  await applyPlatformModelOverrides({});
  const orchestrated = isManagerOrchestratedRequest(event);
  setOrchestratedByManager(orchestrated);
  const started = Date.now();
  const body = await readBody<{
    query?: string;
    message?: string;
    rawQuery?: string;
    skipLlmRerank?: boolean;
    skipEvidenceSelect?: boolean;
    fastPath?: boolean;
    userId?: string;
    manager_rag_task_json?: string;
  }>(event);

  const managerTask = parseManagerRagTaskFromJson(body?.manager_rag_task_json);
  setManagerRagTask(managerTask);

  const raw = String(body?.query ?? body?.message ?? body?.rawQuery ?? "").trim();
  if (!raw) {
    throw createError({
      statusCode: 400,
      statusMessage: "query、message 或 rawQuery 不能为空（总管预取须传非空问句）",
    });
  }

  const sanitized = sanitizeIncomingQuestion(raw, managerTask) || raw;
  const sessionId =
    String(event.node.req.headers["x-session-id"] ?? "").trim() ||
    String(event.node.req.headers["x-conversation-id"] ?? "").trim() ||
    undefined;
  const agentUserId = await resolveAgentUserId({
    headerUserId: String(event.node.req.headers["x-user-id"] ?? "").trim() || undefined,
    bodyUserId: body?.userId,
    sessionId,
    authorization: String(event.node.req.headers.authorization ?? ""),
  });
  const access = checkUserAccess(agentUserId);
  if (!access.allowed) {
    throw createError({ statusCode: 403, statusMessage: access.reason || "forbidden" });
  }
  const userKey = resolveUserKeyFromRequest({
    userId: agentUserId,
    headerUserId: agentUserId,
    sessionId,
  });

  try {
    setRetrievalUserKey(userKey);

    const result = await runDocumentRetrieval({
      query: sanitized,
      rawQuery: String(body?.rawQuery ?? raw).trim() || sanitized,
      skipLlmRerank: orchestrated ? body?.skipLlmRerank !== false : Boolean(body?.skipLlmRerank),
      skipEvidenceSelect: orchestrated
        ? body?.skipEvidenceSelect !== false
        : Boolean(body?.skipEvidenceSelect),
      fastPath: orchestrated ? body?.fastPath !== false : Boolean(body?.fastPath),
      userKey,
    });

    const traceId =
      String(event.node.req.headers["x-trace-id"] ?? event.node.req.headers["x-run-id"] ?? "").trim() || undefined;

    const agentResult = buildRagAgentResult({
      query: result.effectiveQuery,
      needsClarify: result.needsClarify,
      ms: result.ms,
      evidence: result.evidence,
      trace_id: traceId,
    });

    void appendAgentTraceLog({
      agent: "rag",
      path: "/api/retrieve",
      trace_id: traceId,
      ok: agentResult.ok,
      latency_ms: Date.now() - started,
      detail: result.rerankMode,
    });

    return {
      ok: true,
      query: result.effectiveQuery,
      needsClarify: result.needsClarify,
      ms: result.ms,
      intent: result.plan.intent,
      sub_queries: result.plan.sub_queries,
      routing_mode: result.routingMode,
      agentic_rounds: result.agenticRounds ?? 0,
      rerank_mode: result.rerankMode,
      clarify_reason: result.clarifyReason,
      experience_hits: result.experienceHits ?? 0,
      ab_variant: result.abVariant,
      bandit_arm: result.banditArm,
      evidence: result.evidence,
      citations: result.evidence.map((e) => ({ source: e.source, quote: e.content })),
      agentResult,
    };
  } finally {
    clearRetrievalUserKey();
  }
});
