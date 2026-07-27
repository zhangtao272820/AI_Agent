import { startRagCuratorScheduler } from "../utils/curator_scheduler";

export default defineNitroPlugin(() => {
  startRagCuratorScheduler();
});
