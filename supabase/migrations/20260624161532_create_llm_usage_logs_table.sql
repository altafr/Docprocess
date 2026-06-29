CREATE TABLE IF NOT EXISTS llm_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  prompt_preview TEXT,
  response_preview TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE llm_usage_logs ENABLE ROW LEVEL SECURITY;

-- Anon and authenticated can read logs (internal banking tool, no user auth)
CREATE POLICY "public_select_llm_logs" ON llm_usage_logs
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_llm_logs" ON llm_usage_logs
  FOR SELECT TO authenticated USING (true);

-- Service role writes (edge functions use SUPABASE_SERVICE_ROLE_KEY)
-- Service role bypasses RLS automatically in Supabase

CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_created_at ON llm_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_function_name ON llm_usage_logs(function_name);
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_model ON llm_usage_logs(model);
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_status ON llm_usage_logs(status);

-- Stats RPC: aggregate metrics for current filters
CREATE OR REPLACE FUNCTION get_llm_usage_stats(
  p_function_name TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT json_build_object(
    'total_calls',    COUNT(*),
    'total_tokens',   COALESCE(SUM(total_tokens), 0),
    'error_count',    COUNT(*) FILTER (WHERE status = 'error'),
    'avg_duration_ms', ROUND(AVG(duration_ms))
  )
  FROM llm_usage_logs
  WHERE (p_function_name IS NULL OR function_name = p_function_name)
    AND (p_model        IS NULL OR model          = p_model)
    AND (p_status       IS NULL OR status         = p_status)
    AND (p_date_from    IS NULL OR created_at     >= p_date_from)
    AND (p_date_to      IS NULL OR created_at     <= p_date_to)
    AND (p_search IS NULL OR prompt_preview   ILIKE '%' || p_search || '%'
                           OR response_preview ILIKE '%' || p_search || '%');
$$;

-- Options RPC: distinct values for filter dropdowns
CREATE OR REPLACE FUNCTION get_llm_usage_options()
RETURNS JSON
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT json_build_object(
    'function_names', (
      SELECT COALESCE(array_agg(DISTINCT function_name ORDER BY function_name), ARRAY[]::text[])
      FROM llm_usage_logs
    ),
    'models', (
      SELECT COALESCE(array_agg(DISTINCT model ORDER BY model), ARRAY[]::text[])
      FROM llm_usage_logs WHERE model IS NOT NULL
    )
  );
$$;
