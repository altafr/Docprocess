-- RPC helper functions used by the knowledge-search edge function.
-- Each returns id, rank, and all columns needed for result cards.

CREATE OR REPLACE FUNCTION search_board_resolutions(
  query_text TEXT,
  result_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  document_name TEXT,
  company_name TEXT,
  resolution_number TEXT,
  resolution_date TEXT,
  resolution_type TEXT,
  purpose_summary TEXT,
  full_text TEXT,
  effective_date TEXT,
  expiry_date TEXT,
  created_at TIMESTAMPTZ,
  rank REAL
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
    ts_rank(br.search_vector, websearch_to_tsquery('english', query_text)) AS rank
  FROM board_resolutions br
  WHERE br.search_vector @@ websearch_to_tsquery('english', query_text)
  ORDER BY rank DESC, br.created_at DESC
  LIMIT result_limit;
$$;

CREATE OR REPLACE FUNCTION search_processed_documents(
  query_text TEXT,
  result_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  file_name TEXT,
  file_size INTEGER,
  category TEXT,
  summary TEXT,
  board_resolution_id UUID,
  processed_at TIMESTAMPTZ,
  rank REAL
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
    ts_rank(pd.search_vector, websearch_to_tsquery('english', query_text)) AS rank
  FROM processed_documents pd
  WHERE pd.search_vector @@ websearch_to_tsquery('english', query_text)
  ORDER BY rank DESC, pd.processed_at DESC
  LIMIT result_limit;
$$;

CREATE OR REPLACE FUNCTION search_company_mandates(
  query_text TEXT,
  result_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  company_name TEXT,
  director_name TEXT,
  title TEXT,
  authorized_products JSONB,
  signing_arrangement TEXT,
  signing_rules JSONB,
  effective_date TEXT,
  expiry_date TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ,
  rank REAL
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
    ts_rank(cm.search_vector, websearch_to_tsquery('english', query_text)) AS rank
  FROM company_mandates cm
  WHERE cm.search_vector @@ websearch_to_tsquery('english', query_text)
  ORDER BY rank DESC, cm.created_at DESC
  LIMIT result_limit;
$$;
