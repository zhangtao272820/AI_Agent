import { z } from "zod";
import { readRagSession } from "../../utils/ragSessionStore";
import { getSessionMemory } from "../../utils/session_memory";

const QuerySchema = z.object({
  sessionId: z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
});

export default defineEventHandler(async (event) => {
  const query = QuerySchema.parse(getQuery(event));
  const session = await readRagSession(query.sessionId);
  const memory = getSessionMemory(query.sessionId);
  return {
    sessionId: query.sessionId,
    messages: session.messages,
    summary: memory.summary || "",
    topics: memory.topics || [],
  };
});
