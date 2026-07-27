-- Phase 13（P1）：Run Trace 回放 + HITL 写闸决策审计

CREATE TABLE IF NOT EXISTS mgr_run_trace_events (
  id BIGSERIAL PRIMARY KEY,
  run_id VARCHAR(80) NOT NULL,
  session_id VARCHAR(120),
  event VARCHAR(40) NOT NULL,
  from_agent VARCHAR(24),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgr_run_trace_run ON mgr_run_trace_events(run_id, id);
CREATE INDEX IF NOT EXISTS idx_mgr_run_trace_session ON mgr_run_trace_events(session_id, ts DESC)
  WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mgr_hitl_decisions (
  id BIGSERIAL PRIMARY KEY,
  run_id VARCHAR(80) NOT NULL,
  session_id VARCHAR(120) NOT NULL,
  confirm_id VARCHAR(120),
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('confirm', 'cancel', 'reject')),
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgr_hitl_run ON mgr_hitl_decisions(run_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_mgr_hitl_session ON mgr_hitl_decisions(session_id, ts DESC);
