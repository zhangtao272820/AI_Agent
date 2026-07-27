-- Phase 4/5：pgvector 经验向量、Admin 会话 PG、联邦画像视图、会话归档
-- AGENT_DATABASE_URL=postgresql://postgres:postgres@localhost:15432/clawhive

CREATE EXTENSION IF NOT EXISTS vector;

-- Manager 经验向量（pgvector；与 mgr_memory_embeddings JSONB 并存）
ALTER TABLE mgr_memory_embeddings ADD COLUMN IF NOT EXISTS embedding_vec vector(1536);

CREATE INDEX IF NOT EXISTS idx_mgr_memory_embeddings_vec
  ON mgr_memory_embeddings USING hnsw (embedding_vec vector_cosine_ops);

-- DB 查询经验向量
CREATE TABLE IF NOT EXISTS db_experience_vectors (
  id BIGSERIAL PRIMARY KEY,
  experience_key VARCHAR(64) NOT NULL UNIQUE,
  question_norm VARCHAR(120) NOT NULL,
  hint TEXT NOT NULL,
  path VARCHAR(32),
  data_domain VARCHAR(64),
  embedding_vec vector(1536) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_experience_vectors_norm ON db_experience_vectors(question_norm);
CREATE INDEX IF NOT EXISTS idx_db_experience_vectors_vec
  ON db_experience_vectors USING hnsw (embedding_vec vector_cosine_ops);

-- Admin 会话（短期记忆 PG 化）
CREATE TABLE IF NOT EXISTS adm_session_turns (
  id BIGSERIAL PRIMARY KEY,
  session_id VARCHAR(120) NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adm_session_turns_session ON adm_session_turns(session_id, id);

CREATE TABLE IF NOT EXISTS adm_session_task_contexts (
  session_id VARCHAR(120) PRIMARY KEY,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 会话冷归档（超 TTL 的 mgr_session_turns）
CREATE TABLE IF NOT EXISTS mgr_session_turns_archive (
  id BIGSERIAL PRIMARY KEY,
  session_id VARCHAR(80) NOT NULL,
  turn_index INTEGER NOT NULL,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgr_session_turns_archive_session
  ON mgr_session_turns_archive(session_id, turn_index);

-- 跨 Agent 用户画像联邦视图（DB 偏好 + 可扩展 mgr profile）
CREATE OR REPLACE VIEW shared_user_context_view AS
SELECT
  u.user_key,
  u.payload AS db_preferences,
  u.updated_at AS db_updated_at
FROM db_user_preferences u;
