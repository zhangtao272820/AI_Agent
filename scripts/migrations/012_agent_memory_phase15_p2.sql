-- Phase 15（P2）：Code / Extractor / Lobster 经验联邦 + MCP Tool Registry

CREATE TABLE IF NOT EXISTS code_query_experience (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  question_norm VARCHAR(120) NOT NULL,
  task_kind VARCHAR(32),
  hint_files JSONB,
  hint TEXT NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manager_finalize_sync',
  status VARCHAR(16) NOT NULL DEFAULT 'confirmed',
  run_id VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_code_query_experience_norm ON code_query_experience(question_norm);
CREATE INDEX IF NOT EXISTS idx_code_query_experience_kind ON code_query_experience(task_kind);
CREATE INDEX IF NOT EXISTS idx_code_query_experience_status ON code_query_experience(status);

CREATE TABLE IF NOT EXISTS ext_crawl_experience (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  task_norm VARCHAR(120) NOT NULL,
  target_site VARCHAR(128),
  content_type VARCHAR(64),
  channel VARCHAR(32),
  seed_url TEXT,
  fields JSONB,
  hint TEXT NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manager_finalize_sync',
  status VARCHAR(16) NOT NULL DEFAULT 'confirmed',
  run_id VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_crawl_experience_norm ON ext_crawl_experience(task_norm);
CREATE INDEX IF NOT EXISTS idx_ext_crawl_experience_site ON ext_crawl_experience(target_site);

CREATE TABLE IF NOT EXISTS lob_gui_experience (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  task_norm VARCHAR(120) NOT NULL,
  scenario VARCHAR(64),
  execution_mode VARCHAR(16),
  hint TEXT NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manager_finalize_sync',
  status VARCHAR(16) NOT NULL DEFAULT 'confirmed',
  run_id VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lob_gui_experience_norm ON lob_gui_experience(task_norm);
CREATE INDEX IF NOT EXISTS idx_lob_gui_experience_scenario ON lob_gui_experience(scenario);

CREATE TABLE IF NOT EXISTS mgr_mcp_tool_registry (
  id BIGSERIAL PRIMARY KEY,
  server_name VARCHAR(64) NOT NULL,
  tool_name VARCHAR(128) NOT NULL,
  description TEXT,
  agent_hint VARCHAR(32),
  risk VARCHAR(16) NOT NULL DEFAULT 'medium',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source VARCHAR(32) NOT NULL DEFAULT 'env',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(server_name, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_mgr_mcp_tool_registry_agent ON mgr_mcp_tool_registry(agent_hint);
CREATE INDEX IF NOT EXISTS idx_mgr_mcp_tool_registry_enabled ON mgr_mcp_tool_registry(enabled);
