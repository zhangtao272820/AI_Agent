import { z } from "zod";
import { listDbSessionFeedback } from "../utils/dbSessionFeedback";

const QuerySchema = z.object({
  sessionId: z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
});

export default defineEventHandler(async (event) => {
  const query = QuerySchema.parse(getQuery(event));
  const items = await listDbSessionFeedback("db", query.sessionId);
  return {
    items: items.map((it) => ({
      feedbackKey: it.feedbackKey,
      turnId: it.turnId,
      userMessageIndex: it.userMessageIndex,
      runId: it.runId,
      score: it.score,
      question: it.question,
      updatedAt: it.updatedAt,
    })),
  };
});
