-- ─── Unified keyword search (1 DB call instead of 3) ─────────────────────────
CREATE OR REPLACE FUNCTION search_knowledge_keyword(
  query_text    TEXT,
  source_filter TEXT[]  DEFAULT ARRAY['board_resolution','processed_document','company_mandate'],
  result_limit  INT     DEFAULT 20
)
RETURNS TABLE (
  id         UUID,
  source     TEXT,
  rank       FLOAT,
  title      TEXT,
  subtitle   TEXT,
  snippet    TEXT,
  meta       JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  (
    SELECT
      br.id, 'board_resolution'::TEXT,
      ts_rank(br.search_vector, websearch_to_tsquery('english', query_text))::FLOAT,
      COALESCE(br.document_name, br.resolution_type, 'Board Resolution'),
      array_to_string(array_remove(ARRAY[br.company_name, br.resolution_number, br.resolution_date], NULL), ' · '),
      COALESCE(br.purpose_summary, LEFT(br.full_text, 300), ''),
      jsonb_build_object(
        'company_name',    br.company_name,
        'resolution_type', br.resolution_type,
        'resolution_date', br.resolution_date,
        'effective_date',  br.effective_date,
        'expiry_date',     br.expiry_date
      ),
      br.created_at
    FROM board_resolutions br
    WHERE 'board_resolution' = ANY(source_filter)
      AND br.search_vector @@ websearch_to_tsquery('english', query_text)
    ORDER BY 3 DESC
    LIMIT result_limit
  )
  UNION ALL
  (
    SELECT
      pd.id, 'processed_document'::TEXT,
      ts_rank(pd.search_vector, websearch_to_tsquery('english', query_text))::FLOAT,
      pd.file_name,
      COALESCE(pd.category, 'Uncategorised'),
      LEFT(COALESCE(pd.summary, ''), 300),
      jsonb_build_object('category', pd.category, 'file_size', pd.file_size),
      pd.processed_at
    FROM processed_documents pd
    WHERE 'processed_document' = ANY(source_filter)
      AND pd.search_vector @@ websearch_to_tsquery('english', query_text)
    ORDER BY 3 DESC
    LIMIT result_limit
  )
  UNION ALL
  (
    SELECT
      cm.id, 'company_mandate'::TEXT,
      ts_rank(cm.search_vector, websearch_to_tsquery('english', query_text))::FLOAT,
      cm.director_name,
      array_to_string(array_remove(ARRAY[cm.company_name, cm.title], NULL), ' · '),
      COALESCE(cm.notes, COALESCE(cm.signing_arrangement, '') || ' signing'),
      jsonb_build_object(
        'company_name',       cm.company_name,
        'signing_arrangement',cm.signing_arrangement,
        'effective_date',     cm.effective_date,
        'expiry_date',        cm.expiry_date
      ),
      cm.created_at
    FROM company_mandates cm
    WHERE 'company_mandate' = ANY(source_filter)
      AND cm.search_vector @@ websearch_to_tsquery('english', query_text)
    ORDER BY 3 DESC
    LIMIT result_limit
  )
$$;

-- ─── Unified semantic/vector search (1 DB call instead of 3) ─────────────────
CREATE OR REPLACE FUNCTION search_knowledge_semantic(
  query_embedding vector(1024),
  source_filter   TEXT[]  DEFAULT ARRAY['board_resolution','processed_document','company_mandate'],
  result_limit    INT     DEFAULT 20,
  min_similarity  FLOAT   DEFAULT 0.25
)
RETURNS TABLE (
  id         UUID,
  source     TEXT,
  similarity FLOAT,
  title      TEXT,
  subtitle   TEXT,
  snippet    TEXT,
  meta       JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  (
    SELECT
      br.id, 'board_resolution'::TEXT,
      (1 - (br.embedding <=> query_embedding))::FLOAT,
      COALESCE(br.document_name, br.resolution_type, 'Board Resolution'),
      array_to_string(array_remove(ARRAY[br.company_name, br.resolution_number, br.resolution_date], NULL), ' · '),
      COALESCE(br.purpose_summary, LEFT(br.full_text, 300), ''),
      jsonb_build_object(
        'company_name',    br.company_name,
        'resolution_type', br.resolution_type,
        'resolution_date', br.resolution_date,
        'effective_date',  br.effective_date,
        'expiry_date',     br.expiry_date
      ),
      br.created_at
    FROM board_resolutions br
    WHERE 'board_resolution' = ANY(source_filter)
      AND br.embedding IS NOT NULL
      AND 1 - (br.embedding <=> query_embedding) >= min_similarity
    ORDER BY br.embedding <=> query_embedding
    LIMIT result_limit
  )
  UNION ALL
  (
    SELECT
      pd.id, 'processed_document'::TEXT,
      (1 - (pd.embedding <=> query_embedding))::FLOAT,
      pd.file_name,
      COALESCE(pd.category, 'Uncategorised'),
      LEFT(COALESCE(pd.summary, ''), 300),
      jsonb_build_object('category', pd.category, 'file_size', pd.file_size),
      pd.processed_at
    FROM processed_documents pd
    WHERE 'processed_document' = ANY(source_filter)
      AND pd.embedding IS NOT NULL
      AND 1 - (pd.embedding <=> query_embedding) >= min_similarity
    ORDER BY pd.embedding <=> query_embedding
    LIMIT result_limit
  )
  UNION ALL
  (
    SELECT
      cm.id, 'company_mandate'::TEXT,
      (1 - (cm.embedding <=> query_embedding))::FLOAT,
      cm.director_name,
      array_to_string(array_remove(ARRAY[cm.company_name, cm.title], NULL), ' · '),
      COALESCE(cm.notes, COALESCE(cm.signing_arrangement, '') || ' signing'),
      jsonb_build_object(
        'company_name',       cm.company_name,
        'signing_arrangement',cm.signing_arrangement,
        'effective_date',     cm.effective_date,
        'expiry_date',        cm.expiry_date
      ),
      cm.created_at
    FROM company_mandates cm
    WHERE 'company_mandate' = ANY(source_filter)
      AND cm.embedding IS NOT NULL
      AND 1 - (cm.embedding <=> query_embedding) >= min_similarity
    ORDER BY cm.embedding <=> query_embedding
    LIMIT result_limit
  )
$$;

-- ─── Bulk-update embeddings — one round-trip per batch ───────────────────────
-- Each element of p_embeddings is a JSON-array string e.g. "[0.1,0.2,...]"
CREATE OR REPLACE FUNCTION bulk_update_embeddings(
  p_table      TEXT,
  p_ids        UUID[],
  p_embeddings TEXT[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_table = 'board_resolutions' THEN
    UPDATE board_resolutions t
    SET embedding = v.emb::vector(1024)
    FROM (SELECT unnest(p_ids) AS id, unnest(p_embeddings) AS emb) v
    WHERE t.id = v.id;

  ELSIF p_table = 'processed_documents' THEN
    UPDATE processed_documents t
    SET embedding = v.emb::vector(1024)
    FROM (SELECT unnest(p_ids) AS id, unnest(p_embeddings) AS emb) v
    WHERE t.id = v.id;

  ELSIF p_table = 'company_mandates' THEN
    UPDATE company_mandates t
    SET embedding = v.emb::vector(1024)
    FROM (SELECT unnest(p_ids) AS id, unnest(p_embeddings) AS emb) v
    WHERE t.id = v.id;

  ELSE
    RAISE EXCEPTION 'Unknown table: %', p_table;
  END IF;
END;
$$;
