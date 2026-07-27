import { getUserPreferencesAsync, getUserPreferencesSummaryAsync } from "../../../utils/user_preferences";
import { ensureInternalAgentAccess } from "../../utils/internal_auth";
import { resolveUserKey } from "#agent-shared/resolveUserKey";
import { queryFederatedUserContext } from "#agent-shared/agentVectorPg";

/** GET /api/internal/user-context?user_key= — 跨 Agent 画像（替代 sibling 文件读） */
export default defineEventHandler(async (event) => {
  ensureInternalAgentAccess(event);
  const q = getQuery(event);
  const userKey = resolveUserKey({
    userId: String(q.user_key || q.userKey || q.user_id || ""),
    sessionId: String(q.session_id || q.sessionId || ""),
    conversationId: String(q.conversation_id || ""),
  });
  const prefs = await getUserPreferencesAsync(userKey === "__global__" ? undefined : userKey);
  const federated = await queryFederatedUserContext(userKey);
  return {
    ok: true,
    userKey,
    preferences: prefs,
    federated,
    summary: await getUserPreferencesSummaryAsync(),
    ts: new Date().toISOString(),
  };
});
