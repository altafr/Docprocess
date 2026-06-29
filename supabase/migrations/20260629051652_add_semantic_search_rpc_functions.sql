-- Semantic (vector) search RPC functions.
-- query_embedding is a 1024-dim vector from mistral-embed.
-- Returns rows ordered by cosine similarity (closest first).

CREATE OR REPLACE FUNCTION search_board_resolutions_semantic(
  query_embedding vector(1024),
  result_limit    INT   DEFAULT 20,
  min_similarity  FLOAT DEFAULT 0.25
)
RETURNS TABLE (
  id               UUID,
  document_name    TEXT,
  company_name     TEXT,
  resolution_number TEXT,
  resolution_date  TEXT,
  resolution_type  TEXT,
  purpose_summary  TEXT,
  full_text        TEXT,
  effective_date   TEXT,
  expiry_date      TEXT,
  created_at       TIMESTAMPTZ,
  similarity       FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    br.id,
    br.document_name,
    br.company_name,
    br.resolution_number,
    br.resolution_date,
    br.resolution_type,
    br.purpose_summary,
    br.full_text,
    br.effective_date,
    br.expiry_date,
    br.created_at,
    1 - (br.embedding <=> query_embedding) AS similarity
  FROM board_resolutions br
  WHERE br.embedding IS NOT NULL
    AND 1 - (br.embedding <=> query_embedding) >= min_similarity
  ORDER BY br.embedding <=> query_embedding
  LIMIT result_limit;
$$;

CREATE OR REPLACE FUNCTION search_processed_documents_semantic(
  query_embedding vector(1024),
  result_limit    INT   DEFAULT 20,
  min_similarity  FLOAT DEFAULT 0.25
)
RETURNS TABLE (
  id                  UUID,
  file_name           TEXT,
  file_size           INTEGER,
  category            TEXT,
  summary             TEXT,
  board_resolution_id UUID,
  processed_at        TIMESTAMPTZ,
  similarity          FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    pd.id,
    pd.file_name,
    pd.file_size,
    pd.category,
    pd.summary,
    pd.board_resolution_id,
    pd.processed_at,
    1 - (pd.embedding <=> query_embedding) AS similarity
  FROM processed_documents pd
  WHERE pd.embedding IS NOT NULL
    AND 1 - (pd.embedding <=> query_embedding) >= min_similarity
  ORDER BY pd.embedding <=> query_embedding
  LIMIT result_limit;
$$;

CREATE OR REPLACE FUNCTION search_company_mandates_semantic(
  query_embedding vector(1024),
  result_limit    INT   DEFAULT 20,
  min_similarity  FLOAT DEFAULT 0.25
)
RETURNS TABLE (
  id                   UUID,
  company_name         TEXT,
  director_name        TEXT,
  title                TEXT,
  authorized_products  JSONB,
  signing_arrangement  TEXT,
  signing_rules        JSONB,
  effective_date       TEXT,
  expiry_date          TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ,
  similarity           FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    cm.id,
    cm.company_name,
    cm.director_name,
    cm.title,
    cm.authorized_products,
    cm.signing_arrangement,
    cm.signing_rules,
    cm.effective_date,
    cm.expiry_date,
    cm.notes,
    cm.created_at,
    1 - (cm.embedding <=> query_embedding) AS similarity
  FROM company_mandates cm
  WHERE cm.embedding IS NOT NULL
    AND 1 - (cm.embedding <=> query_embedding) >= min_similarity
  ORDER BY cm.embedding <=> query_embedding
  LIMIT result_limit;
$$;

-- Helper: returns counts of unembedded records (used by the UI to decide if indexing is needed)
CREATE OR REPLACE FUNCTION knowledge_embedding_stats()
RETURNS TABLE (
  table_name      TEXT,
  total_rows      BIGINT,
  embedded_rows   BIGINT,
  pending_rows    BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT 'board_resolutions'::TEXT,   COUNT(*), COUNT(embedding), COUNT(*) - COUNT(embedding) FROM board_resolutions
  UNION ALL
  SELECT 'processed_documents'::TEXT, COUNT(*), COUNT(embedding), COUNT(*) - COUNT(embedding) FROM processed_documents
  UNION ALL
  SELECT 'company_mandates'::TEXT,    COUNT(*), COUNT(embedding), COUNT(*) - COUNT(embedding) FROM company_mandates;
$$;
