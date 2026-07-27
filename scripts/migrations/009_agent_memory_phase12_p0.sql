-- Phase 12 (P0)：用户反馈门控产物学习

CREATE TABLE IF NOT EXISTS db_query_templates (
  id VARCHAR(80) PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  question_norm VARCHAR(120) NOT NULL,
  data_domain VARCHAR(64),
  tables JSONB NOT NULL DEFAULT '[]'::jsonb,
  sql TEXT NOT NULL,
  sql_hash VARCHAR(64) NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'shadow'
    CHECK (status IN ('shadow', 'confirmed', 'revoked')),
  run_id VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_query_templates_norm ON db_query_templates(question_norm);
CREATE INDEX IF NOT EXISTS idx_db_query_templates_hash ON db_query_templates(sql_hash);
CREATE INDEX IF NOT EXISTS idx_db_query_templates_status ON db_query_templates(status);
CREATE INDEX IF NOT EXISTS idx_db_query_templates_run ON db_query_templates(run_id) WHERE run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rag_retrieval_artifacts (
  id BIGSERIAL PRIMARY KEY,
  run_id VARCHAR(80),
  question_norm VARCHAR(120) NOT NULL,
  source_labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  chunk_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  path VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'shadow'
    CHECK (status IN ('shadow', 'confirmed', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_retrieval_artifacts_run ON rag_retrieval_artifacts(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rag_retrieval_artifacts_norm ON rag_retrieval_artifacts(question_norm);
CREATE INDEX IF NOT EXISTS idx_rag_retrieval_artifacts_status ON rag_retrieval_artifacts(status);

CREATE TABLE IF NOT EXISTS mgr_run_artifacts (
  run_id VARCHAR(80) PRIMARY KEY,
  session_id VARCHAR(120),
  question TEXT,
  tool_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
  sub_artifacts JSONB NOT NULL DEFAULT '{}'::jsonb,
  federation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'shadow'
    CHECK (status IN ('shadow', 'confirmed', 'revoked')),
  feedback_score SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgr_run_artifacts_session ON mgr_run_artifacts(session_id);
CREATE INDEX IF NOT EXISTS idx_mgr_run_artifacts_status ON mgr_run_artifacts(status);

ALTER TABLE adm_tool_experience ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'shadow';
ALTER TABLE adm_tool_experience ADD COLUMN IF NOT EXISTS run_id VARCHAR(80);
ALTER TABLE adm_tool_experience ADD COLUMN IF NOT EXISTS tools_json JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_adm_tool_experience_run ON adm_tool_experience(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_adm_tool_experience_status ON adm_tool_experience(status);
