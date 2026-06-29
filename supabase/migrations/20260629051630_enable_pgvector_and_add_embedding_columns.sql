-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── board_resolutions ───────────────────────────────────────────────────────
ALTER TABLE board_resolutions
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

CREATE INDEX IF NOT EXISTS idx_board_resolutions_embedding
  ON board_resolutions USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ─── processed_documents ─────────────────────────────────────────────────────
ALTER TABLE processed_documents
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

CREATE INDEX IF NOT EXISTS idx_processed_documents_embedding
  ON processed_documents USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ─── company_mandates ────────────────────────────────────────────────────────
ALTER TABLE company_mandates
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

CREATE INDEX IF NOT EXISTS idx_company_mandates_embedding
  ON company_mandates USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
