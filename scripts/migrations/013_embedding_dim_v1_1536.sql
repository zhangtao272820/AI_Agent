-- Phase 16：pgvector 维度 1024 → 1536（text-embedding-v1 全维，与 v3 经验向量不兼容故清空重建）

CREATE EXTENSION IF NOT EXISTS vector;

DROP INDEX IF EXISTS idx_mgr_memory_embeddings_vec;
DROP INDEX IF EXISTS idx_db_experience_vectors_vec;

TRUNCATE TABLE db_experience_vectors, mgr_memory_embeddings RESTART IDENTITY;

ALTER TABLE mgr_memory_embeddings DROP COLUMN IF EXISTS embedding_vec;
ALTER TABLE mgr_memory_embeddings ADD COLUMN embedding_vec vector(1536);

ALTER TABLE db_experience_vectors DROP COLUMN IF EXISTS embedding_vec;
ALTER TABLE db_experience_vectors ADD COLUMN embedding_vec vector(1536) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mgr_memory_embeddings_vec
  ON mgr_memory_embeddings USING hnsw (embedding_vec vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_db_experience_vectors_vec
  ON db_experience_vectors USING hnsw (embedding_vec vector_cosine_ops);
