-- Phase 2/3：会话摘要、用户偏好、进化审计与向量辅助表（幂等）
-- AGENT_DATABASE_URL=postgresql://postgres:postgres@localhost:15432/clawhive

CREATE TABLE IF NOT EXISTS mgr_session_summaries (
  session_id VARCHAR(80) PRIMARY KEY REFERENCES mgr_sessions(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  source VARCHAR(16) NOT NULL DEFAULT 'rule' CHECK (source IN ('rule', 'llm')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mgr_memory_embeddings (
  id BIGSERIAL PRIMARY KEY,
  memory_key VARCHAR(64) NOT NULL,
  user_key VARCHAR(64) NOT NULL DEFAULT '__global__',
  entry_type VARCHAR(32) NOT NULL DEFAULT 'experience',
  embedding JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(memory_key)
);

CREATE INDEX IF NOT EXISTS idx_mgr_memory_embeddings_user
  ON mgr_memory_embeddings(user_key, entry_type, ts DESC);

CREATE TABLE IF NOT EXISTS db_user_preferences (
  user_key VARCHAR(64) PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evo_audit_runs (
  id BIGSERIAL PRIMARY KEY,
  job_name VARCHAR(64) NOT NULL,
  agent VARCHAR(32),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  report JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_evo_audit_runs_job
  ON evo_audit_runs(job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS evo_curator_state (
  job_key VARCHAR(64) PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_report JSONB NOT NULL DEFAULT '{}'::jsonb
);
