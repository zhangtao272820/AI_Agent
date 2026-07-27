import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { BaseMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import type { DataSource } from "typeorm";
import type { createAgentSkills, SkillRunContext } from "../skills";

export type DbGraphRuntimeConfig = {
  dbId?: string;
  domain?: string;
  enableDomainSkills?: boolean;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  openaiOrchestrationModel?: string;
  openaiNluModel?: string;
  openaiAgentModel?: string;
  openaiComplexModel?: string;
  openaiEmbeddingModel?: string;
  mysql: { host: string; port: number; user: string; password: string; database: string };
  mcpServers?: Record<string, unknown>;
};

export type DbGraphSkillState = {
  standalone_question?: string;
  question?: string;
  query_plan_json?: string;
  sql_preflight_json?: string;
  manager_task_json?: string;
  schema_ground_json?: string;
  route_policy_json?: string;
};

export type DbGraphEarlyDeps = {
  model: BaseLanguageModel;
  nluModel?: BaseLanguageModel;
  largerModel?: BaseLanguageModel;
  progress?: (text: string) => void;
  standaloneQuestionChain: Runnable<{ chat_history: BaseMessage[]; question: string }, string>;
};

export type DbGraphDeps = DbGraphEarlyDeps & {
  config: DbGraphRuntimeConfig;
  ds: DataSource;
  domainEnabled: boolean;
  skills: ReturnType<typeof createAgentSkills>;
  skillRunCtx: (state: DbGraphSkillState) => SkillRunContext;
  routingChain: Runnable<{ standalone_question: string }, string>;
  embeddingConfig: {
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    embeddingModel?: string;
    embeddingDimensions: number;
  };
};

export type DbGraphCompileRefs = {
  compiledGraph: { invoke: (input: Record<string, unknown>) => Promise<Record<string, unknown>> } | null;
};
