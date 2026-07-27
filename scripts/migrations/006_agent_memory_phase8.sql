-- Phase 8：Task stack PG 化

CREATE TABLE IF NOT EXISTS mgr_task_stacks (
  session_id VARCHAR(80) PRIMARY KEY REFERENCES mgr_sessions(id) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgr_task_stacks_updated
  ON mgr_task_stacks(updated_at DESC);
