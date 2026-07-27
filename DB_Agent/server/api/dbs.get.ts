import { getDbConnections } from "../../utils/runtime";

/** 单库：返回当前连接库信息（兼容前端 /api/dbs 调用，无多库选项） */
export default defineEventHandler((event) => {
  const runtimeConfig = useRuntimeConfig(event) as any;
  const dbConnections = getDbConnections(runtimeConfig) as Record<string, any>;
  const entry = dbConnections.default;
  const database = String(entry?.mysql?.database || runtimeConfig?.mysql?.database || "").trim();
  const id = "default";
  const label = database || id;

  return {
    defaultDbId: id,
    options: [{ id, label }],
    singleDb: true,
    database,
  };
});
