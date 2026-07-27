-- Phase 7：Tool Memory、Skill Draft PG、Memory Fold 状态、Working 索引

CREATE TABLE IF NOT EXISTS mgr_tool_memory (
  id BIGSERIAL PRIMARY KEY,
  agent VARCHAR(32) NOT NULL,
  tool_name VARCHAR(128) NOT NULL,
  context_key VARCHAR(128) NOT NULL DEFAULT '__global__',
  trials INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  avg_ms REAL NOT NULL DEFAULT 0,
  last_ok BOOLEAN,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent, tool_name, context_key)
);

CREATE INDEX IF NOT EXISTS idx_mgr_tool_memory_agent
  ON mgr_tool_memory(agent, updated_at DESC);

CREATE TABLE IF NOT EXISTS mgr_skill_drafts (
  skill_id VARCHAR(128) PRIMARY KEY,
  agent VARCHAR(32) NOT NULL,
  markdown TEXT NOT NULL,
  source_run_id VARCHAR(80),
  success_score REAL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'promoted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgr_skill_drafts_status
  ON mgr_skill_drafts(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS mgr_session_fold_state (
  session_id VARCHAR(80) PRIMARY KEY,
  folded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fold_summary TEXT NOT NULL DEFAULT '',
  turn_count INTEGER NOT NULL DEFAULT 0,
  source VARCHAR(16) NOT NULL DEFAULT 'archive' CHECK (source IN ('archive', 'summary', 'llm'))
);

CREATE INDEX IF NOT EXISTS idx_mgr_memory_entries_session_working
  ON mgr_memory_entries ((payload->>'sessionId'))
  WHERE entry_type = 'working';

CREATE INDEX IF NOT EXISTS idx_mgr_memory_entries_reflection_scenario
  ON mgr_memory_entries ((payload->>'scenarioKey'))
  WHERE entry_type = 'reflection';
