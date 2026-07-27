-- Agent 记忆与存储数据库化 — 全量 schema（幂等）
-- AGENT_DATABASE_URL=postgresql://postgres:postgres@localhost:15432/clawhive

CREATE TABLE IF NOT EXISTS mgr_sessions (
  id VARCHAR(80) PRIMARY KEY,
  user_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mgr_session_turns (
  id BIGSERIAL PRIMARY KEY,
  session_id VARCHAR(80) NOT NULL REFERENCES mgr_sessions(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_mgr_session_turns_session ON mgr_session_turns(session_id, turn_index);

CREATE TABLE IF NOT EXISTS mgr_memory_entries (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entry_type VARCHAR(32) NOT NULL DEFAULT 'experience',
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgr_memory_entries_type_ts ON mgr_memory_entries(entry_type, ts DESC);

CREATE TABLE IF NOT EXISTS db_learning_signals (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  question TEXT NOT NULL,
  question_norm VARCHAR(120) NOT NULL,
  path VARCHAR(32),
  ok BOOLEAN NOT NULL,
  empty BOOLEAN,
  data_domain VARCHAR(64),
  intent VARCHAR(64),
  tables JSONB,
  ms INTEGER,
  reason TEXT,
  feedback REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_learning_signals_ts ON db_learning_signals(ts DESC);

CREATE TABLE IF NOT EXISTS db_route_stats (
  id BIGSERIAL PRIMARY KEY,
  context_key VARCHAR(128) NOT NULL,
  path VARCHAR(32) NOT NULL,
  trials INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  empty_count INTEGER NOT NULL DEFAULT 0,
  avg_ms REAL NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(context_key, path)
);

CREATE TABLE IF NOT EXISTS db_query_experience (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  question_norm VARCHAR(120) NOT NULL,
  path VARCHAR(32),
  data_domain VARCHAR(64),
  tables JSONB,
  hint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rag_learning_signals (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  question TEXT NOT NULL,
  question_norm VARCHAR(120),
  score REAL NOT NULL,
  comment TEXT,
  path VARCHAR(64),
  source VARCHAR(256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_learning_signals_at ON rag_learning_signals(at DESC);

CREATE TABLE IF NOT EXISTS rag_route_preferences (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS rag_session_memory (
  session_id VARCHAR(120) PRIMARY KEY,
  summary TEXT NOT NULL DEFAULT '',
  topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evo_policy_versions (
  id BIGSERIAL PRIMARY KEY,
  agent VARCHAR(32) NOT NULL,
  stage VARCHAR(64) NOT NULL,
  version INTEGER NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('shadow', 'active', 'rolled_back')),
  payload JSONB NOT NULL,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent, stage, version)
);
