import { runLearningCurator } from "../../../utils/learning_curator";
import { ensureRateLimit } from "../../../utils/rate";

export default defineEventHandler(async (event) => {
  ensureRateLimit(event, { max: 20, refillPerSec: 5 });
  const body = (await readBody(event).catch(() => null)) as {
    autoPromote?: boolean;
    minHits?: number;
  } | null;
  const report = await runLearningCurator({
    autoPromote: body?.autoPromote !== false,
    minHits: Number.isFinite(body?.minHits) ? Number(body!.minHits) : undefined,
  });
  return { ok: true, report };
});
