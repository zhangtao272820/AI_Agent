-- Phase 11：Admin 工具经验联邦 + RAG 联邦索引

CREATE TABLE IF NOT EXISTS adm_tool_experience (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  question_norm VARCHAR(120) NOT NULL,
  tool_name VARCHAR(64),
  scenario VARCHAR(64),
  hint TEXT NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manager_finalize_sync',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adm_tool_experience_norm ON adm_tool_experience(question_norm);
CREATE INDEX IF NOT EXISTS idx_adm_tool_experience_scenario ON adm_tool_experience(scenario);

CREATE INDEX IF NOT EXISTS idx_rag_learning_signals_source
  ON rag_learning_signals(source)
  WHERE source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rag_learning_signals_path
  ON rag_learning_signals(path)
  WHERE path IS NOT NULL;
