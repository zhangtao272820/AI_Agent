import { z } from "zod";
import { truncateRagSessionFromUserIndex } from "../../utils/ragSessionStore";
import {
  deleteRagSessionFeedbackAtUserMessageIndex,
  deleteRagSessionFeedbackFromTurn,
  deleteRagSessionFeedbackFromUserIndex,
} from "../../utils/ragSessionFeedback";

const BodySchema = z.object({
  sessionId: z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  fromUserIndex: z.number().int().min(0).max(500),
  fromTurnId: z.number().int().min(0).max(500).optional(),
  replaceUserText: z.string().max(8000).optional(),
  userId: z.string().max(120).optional(),
});

export default defineEventHandler(async (event) => {
  const body = BodySchema.parse(await readBody(event));
  const result = await truncateRagSessionFromUserIndex(body.sessionId, body.fromUserIndex, {
    userId: body.userId,
    replaceUserText: body.replaceUserText,
  });
  let feedbackDeleted = 0;
  if (body.replaceUserText != null && body.replaceUserText !== "") {
    feedbackDeleted += await deleteRagSessionFeedbackAtUserMessageIndex(
      "rag",
      body.sessionId,
      body.fromUserIndex
    );
  } else {
    if (body.fromTurnId != null) {
      feedbackDeleted += await deleteRagSessionFeedbackFromTurn("rag", body.sessionId, body.fromTurnId);
    }
    feedbackDeleted += await deleteRagSessionFeedbackFromUserIndex("rag", body.sessionId, body.fromUserIndex);
  }
  return {
    ok: true,
    sessionId: body.sessionId,
    userCount: result.userCount,
    messageCount: result.messages.length,
    feedbackDeleted,
  };
});
