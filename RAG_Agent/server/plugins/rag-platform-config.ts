import { applyPlatformModelOverrides } from "../utils/platform_config";

/** 启动时同步 ClawHive 能力层模型到 process.env（与 DB/Extractor 一致）。 */
export default defineNitroPlugin(() => {
  void applyPlatformModelOverrides({}).catch(() => {});
});
