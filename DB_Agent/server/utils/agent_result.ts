export type AgentSource = {
  type: "url" | "doc" | "table" | "sql";
  ref: string;
};

export type AgentResult = {
  ok: boolean;
  agent: string;
  trace_id?: string;
  answer?: string;
  sources?: AgentSource[];
  structured?: Record<string, unknown>;
  needs_clarify?: boolean;
  clarify_questions?: string[];
  error_code?: string;
  latency_ms?: number;
};

export function buildDbAgentResult(params: {
  answer: string;
  empty: boolean;
  reason: string;
  run_id?: string;
  trace_id?: string;
  needs_clarification?: boolean;
  clarification_question?: string;
  explain_preflight?: string[];
  executed_sql?: string;
}): AgentResult {
  const sources: AgentSource[] = [];
  if (params.run_id) sources.push({ type: "sql", ref: params.run_id });
  const needsClarify = Boolean(params.needs_clarification);
  return {
    ok: !params.empty && !needsClarify,
    agent: "db",
    trace_id: params.trace_id,
    answer: params.answer,
    sources: sources.length ? sources : undefined,
    structured: {
      empty: params.empty,
      reason: params.reason,
      run_id: params.run_id,
      ...(params.executed_sql ? { executed_sql: params.executed_sql } : {}),
      ...(params.explain_preflight?.length ? { explain_preflight: params.explain_preflight } : {}),
    },
    needs_clarify: needsClarify,
    clarify_questions: needsClarify && params.clarification_question ? [params.clarification_question] : undefined,
    error_code: needsClarify ? "needs_clarify" : params.empty ? "empty_result" : undefined,
  };
}
