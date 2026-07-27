import { getDbAgentBlueprintEnv } from "../../utils/db_agent_env";
import { listMetricsCatalog } from "../../utils/metrics_compiler";

/** 当前域补丁中的 metrics 语义层目录（供前端/运维预览） */
export default defineEventHandler(() => {
  const env = getDbAgentBlueprintEnv();
  return {
    domain: env.domain,
    enabled: env.enableMetricsDirect,
    metrics: listMetricsCatalog(),
  };
});
