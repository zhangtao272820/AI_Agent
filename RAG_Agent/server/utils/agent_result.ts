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

type EvidenceRow = { source?: string; content?: string };

export function buildRagAgentResult(params: {
  query: string;
  needsClarify?: boolean;
  ms?: number;
  evidence?: EvidenceRow[];
  trace_id?: string;
}): AgentResult {
  const sources: AgentSource[] = [];
  for (const row of params.evidence || []) {
    const ref = String(row?.source || "").trim();
    if (ref) sources.push({ type: "doc", ref });
  }
  const needsClarify = Boolean(params.needsClarify);
  return {
    ok: !needsClarify && sources.length > 0,
    agent: "rag",
    trace_id: params.trace_id,
    answer: params.query,
    sources: sources.length ? sources : undefined,
    structured: {
      evidence_count: params.evidence?.length ?? 0,
      ms: params.ms,
    },
    needs_clarify: needsClarify,
    error_code: needsClarify ? "needs_clarify" : sources.length ? undefined : "empty_result",
    latency_ms: params.ms,
  };
}
