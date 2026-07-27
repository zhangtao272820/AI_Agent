-- Phase 6：user-session 映射索引、语义 fact 索引、会话删除优化

CREATE INDEX IF NOT EXISTS idx_mgr_sessions_user_id ON mgr_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_mgr_memory_entries_scenario
  ON mgr_memory_entries ((payload->>'scenarioKey'))
  WHERE entry_type = 'experience';

CREATE INDEX IF NOT EXISTS idx_mgr_memory_embeddings_session
  ON mgr_memory_embeddings ((metadata->>'sessionId'))
  WHERE metadata->>'sessionId' IS NOT NULL;
