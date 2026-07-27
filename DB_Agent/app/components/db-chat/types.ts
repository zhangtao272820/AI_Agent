export type RunMeta = {
  path?: string;
  data_domain?: string;
  intent?: string;
  candidate_tables?: string[];
  primary_tables?: string[];
  route_reason?: string;
  explore_skipped?: boolean;
  needs_clarification?: boolean;
  clarification_question?: string;
  missing_slots?: string[];
  task_stack_steps?: number;
  clarification_suggestions?: string[];
  domain?: string;
  profile?: string;
  query_ir_used?: boolean;
  agent_fallback?: boolean;
  sql_template_direct?: boolean;
  sql_plan_direct?: boolean;
  structural_plan_used?: boolean;
  query_tier?: string;
  query_tier_source?: string;
  llm_calls?: number;
};

export type RuntimeConfig = {
  domain?: string;
  profile?: string;
  mysql_database?: string;
  mysql_host?: string;
  patch?: { hint_count?: number };
  features?: { enableQueryIr?: boolean; enableSqlPlanDirect?: boolean };
};

export type ProcessStep = { kind: string; text: string; at: number };

export type Message = {
  role: "user" | "assistant";
  content: string;
  turnId?: number;
  userMessageIndex?: number;
  meta?: RunMeta;
  feedbackSent?: boolean;
  questionForFeedback?: string;
  clarifyBaseQuestion?: string;
  processSteps?: ProcessStep[];
};

export type SessionHistoryItem = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  userMessageCount: number;
  customTitle?: boolean;
};

export type LearningResetScope = "all" | "learning" | "route" | "prompts";

export type PromptPatch = { id: string; text: string; hits: number; stage?: string };

export type AppModalState = {
  open: boolean;
  mode: "alert" | "confirm" | "prompt";
  title: string;
  message: string;
  inputValue: string;
  inputPlaceholder: string;
  pendingAction: null | string | { type: string; id?: string };
};
