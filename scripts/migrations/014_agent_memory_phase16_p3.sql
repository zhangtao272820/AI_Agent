-- Phase 16（P3）：在线 Eval + OPA 策略 + KG + 多租户审计

-- ── 多租户：核心表补 tenant_id ──
ALTER TABLE mgr_sessions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_mgr_sessions_tenant ON mgr_sessions(tenant_id);

ALTER TABLE mgr_tool_call_audit ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_mgr_tool_call_audit_tenant ON mgr_tool_call_audit(tenant_id, ts DESC);

ALTER TABLE agent_session_feedback ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_session_feedback_tenant ON agent_session_feedback(tenant_id, agent, updated_at DESC);

ALTER TABLE mgr_run_trace_events ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_mgr_run_trace_tenant ON mgr_run_trace_events(tenant_id, ts DESC);

ALTER TABLE mgr_hitl_decisions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_mgr_hitl_tenant ON mgr_hitl_decisions(tenant_id, ts DESC);

-- ── 在线 Eval ──
CREATE TABLE IF NOT EXISTS mgr_eval_suites (
  id VARCHAR(64) PRIMARY KEY,
  agent VARCHAR(32) NOT NULL,
  title VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source VARCHAR(32) NOT NULL DEFAULT 'seed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mgr_eval_cases (
  id BIGSERIAL PRIMARY KEY,
  suite_id VARCHAR(64) NOT NULL REFERENCES mgr_eval_suites(id) ON DELETE CASCADE,
  case_id VARCHAR(64) NOT NULL,
  question TEXT NOT NULL,
  expect_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(suite_id, case_id)
);

CREATE INDEX IF NOT EXISTS idx_mgr_eval_cases_suite ON mgr_eval_cases(suite_id);

CREATE TABLE IF NOT EXISTS mgr_eval_runs (
  id BIGSERIAL PRIMARY KEY,
  suite_id VARCHAR(64) NOT NULL REFERENCES mgr_eval_suites(id) ON DELETE CASCADE,
  trigger_source VARCHAR(32) NOT NULL DEFAULT 'manual',
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  passed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mgr_eval_runs_suite ON mgr_eval_runs(suite_id, started_at DESC);

CREATE TABLE IF NOT EXISTS mgr_eval_results (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES mgr_eval_runs(id) ON DELETE CASCADE,
  case_id VARCHAR(64) NOT NULL,
  ok BOOLEAN NOT NULL,
  detail TEXT,
  ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mgr_eval_results_run ON mgr_eval_results(run_id);

-- ── OPA 风格策略规则 ──
CREATE TABLE IF NOT EXISTS mgr_policy_rules (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  effect VARCHAR(16) NOT NULL CHECK (effect IN ('allow', 'deny', 'audit')),
  priority INTEGER NOT NULL DEFAULT 100,
  match_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source VARCHAR(32) NOT NULL DEFAULT 'seed',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgr_policy_rules_enabled ON mgr_policy_rules(enabled, priority DESC);

-- ── 跨 Agent 知识图谱 ──
CREATE TABLE IF NOT EXISTS mgr_kg_entities (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
  entity_type VARCHAR(32) NOT NULL,
  entity_key VARCHAR(256) NOT NULL,
  label VARCHAR(512),
  source_agent VARCHAR(32),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_run_id VARCHAR(80),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_mgr_kg_entities_tenant_type ON mgr_kg_entities(tenant_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_mgr_kg_entities_key ON mgr_kg_entities(entity_key);

CREATE TABLE IF NOT EXISTS mgr_kg_edges (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
  src_entity_id BIGINT NOT NULL REFERENCES mgr_kg_entities(id) ON DELETE CASCADE,
  rel VARCHAR(32) NOT NULL,
  dst_entity_id BIGINT NOT NULL REFERENCES mgr_kg_entities(id) ON DELETE CASCADE,
  run_id VARCHAR(80),
  weight REAL NOT NULL DEFAULT 1.0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgr_kg_edges_tenant ON mgr_kg_edges(tenant_id, rel);
CREATE INDEX IF NOT EXISTS idx_mgr_kg_edges_src ON mgr_kg_edges(src_entity_id);
CREATE INDEX IF NOT EXISTS idx_mgr_kg_edges_dst ON mgr_kg_edges(dst_entity_id);

-- 默认策略种子
INSERT INTO mgr_policy_rules (id, name, effect, priority, match_json, source)
VALUES
  ('audit_failed_tools', '审计失败工具调用', 'audit', 50, '{"ok": false}'::jsonb, 'seed'),
  ('audit_high_risk_agents', '审计高风险 Agent', 'audit', 60, '{"agents": ["admin", "gui"]}'::jsonb, 'seed'),
  ('deny_gui_without_session', 'GUI 无 session 拒绝', 'deny', 200, '{"agents": ["gui"], "requireSession": true}'::jsonb, 'seed')
ON CONFLICT (id) DO NOTHING;
