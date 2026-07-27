-- Phase 13/14（P1）：Tool Call 审计 + Process/SOP 记忆 + RAG 向量经验 PG

CREATE TABLE IF NOT EXISTS mgr_tool_call_audit (
  id BIGSERIAL PRIMARY KEY,
  run_id VARCHAR(80) NOT NULL,
  session_id VARCHAR(120),
  agent VARCHAR(32) NOT NULL,
  tool_name VARCHAR(128) NOT NULL,
  step_id VARCHAR(64),
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  ms INTEGER,
  error TEXT,
  query_preview TEXT,
  result_preview TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgr_tool_call_audit_run ON mgr_tool_call_audit(run_id, id);
CREATE INDEX IF NOT EXISTS idx_mgr_tool_call_audit_session ON mgr_tool_call_audit(session_id, ts DESC)
  WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mgr_tool_call_audit_agent ON mgr_tool_call_audit(agent, ts DESC);

CREATE TABLE IF NOT EXISTS mgr_process_memory (
  id BIGSERIAL PRIMARY KEY,
  scenario_key VARCHAR(128) NOT NULL DEFAULT '__global__',
  question_norm VARCHAR(120) NOT NULL,
  tool_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
  hint TEXT NOT NULL,
  success_score REAL NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 1,
  source VARCHAR(32) NOT NULL DEFAULT 'manager_finalize',
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scenario_key, question_norm)
);

CREATE INDEX IF NOT EXISTS idx_mgr_process_memory_scenario ON mgr_process_memory(scenario_key, hits DESC);
CREATE INDEX IF NOT EXISTS idx_mgr_process_memory_norm ON mgr_process_memory(question_norm);

CREATE TABLE IF NOT EXISTS rag_experience_vectors (
  id VARCHAR(80) PRIMARY KEY,
  question_norm VARCHAR(120) NOT NULL,
  question TEXT NOT NULL,
  hint TEXT NOT NULL,
  vector JSONB NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_experience_vectors_norm ON rag_experience_vectors(question_norm);
CREATE INDEX IF NOT EXISTS idx_rag_experience_vectors_ts ON rag_experience_vectors(ts DESC);
