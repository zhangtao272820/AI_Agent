import { getDbAgentBlueprintEnv } from "./db_agent_env";
import { resolveMysqlFromEnv, resolveOpenAiFromEnv } from "./runtime_secrets";

type MysqlConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

type DbConnectionEntry = {
  mysql: MysqlConfig;
  domain?: string;
  enableDomainSkills?: boolean;
  mcpServers?: Record<string, any>;
};

/** 单库模式：仅使用 runtimeConfig.mysql */
export function getDbConnections(runtimeConfig: any): Record<string, DbConnectionEntry> {
  const mysql = resolveMysqlFromEnv(runtimeConfig?.mysql);
  if (!mysql.host || !mysql.user || !mysql.database) return {};
  const base: MysqlConfig = {
    host: String(mysql.host),
    port: Number(mysql.port),
    user: String(mysql.user),
    password: String(mysql.password ?? ""),
    database: String(mysql.database),
  };
  const env = getDbAgentBlueprintEnv();
  return {
    default: {
      mysql: base,
      domain: env.domain,
      enableDomainSkills: env.enableDomainSkills,
      mcpServers: runtimeConfig?.mcpServers,
    },
  };
}

export type AgentRuntimeConfig = {
  dbId: string;
  domain: string;
  enableDomainSkills: boolean;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  openaiOrchestrationModel?: string;
  openaiNluModel?: string;
  openaiAgentModel?: string;
  openaiComplexModel?: string;
  openaiEmbeddingModel?: string;
  sqlAgentMaxIter?: number;
  sqlAgentTopK?: number;
  mysql: MysqlConfig;
  mcpServers?: Record<string, any>;
};

/** 单库：忽略请求 dbId，始终连 MYSQL_* */
export function resolveAgentRuntimeConfig(
  runtimeConfig: any,
  _requestedDbId?: string | null,
): AgentRuntimeConfig {
  const dbConnections = getDbConnections(runtimeConfig);
  const selected = dbConnections.default;

  const mysql = resolveMysqlFromEnv(selected?.mysql ?? runtimeConfig?.mysql);
  if (!mysql.host || !mysql.user || !mysql.database) {
    throw new Error("数据库配置无效：请设置 MYSQL_HOST / MYSQL_USER / MYSQL_DATABASE。");
  }

  const env = getDbAgentBlueprintEnv();
  const openai = resolveOpenAiFromEnv(runtimeConfig);
  return {
    dbId: "default",
    domain: env.domain,
    enableDomainSkills: env.enableDomainSkills,
    openaiApiKey: openai.openaiApiKey,
    openaiBaseUrl: openai.openaiBaseUrl,
    openaiModel: openai.openaiModel,
    openaiOrchestrationModel: openai.openaiOrchestrationModel,
    openaiNluModel: openai.openaiNluModel,
    openaiAgentModel: openai.openaiAgentModel,
    openaiComplexModel: openai.openaiComplexModel,
    openaiEmbeddingModel: openai.openaiEmbeddingModel,
    sqlAgentMaxIter: env.sqlAgentMaxIter,
    sqlAgentTopK: env.sqlAgentTopK,
    mysql: {
      host: String(mysql.host),
      port: Number(mysql.port),
      user: String(mysql.user),
      password: String(mysql.password ?? ""),
      database: String(mysql.database),
    },
    mcpServers: selected?.mcpServers ?? runtimeConfig?.mcpServers,
  };
}
