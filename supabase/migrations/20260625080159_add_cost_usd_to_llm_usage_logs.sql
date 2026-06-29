-- Add cost tracking column
ALTER TABLE llm_usage_logs ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12, 8);

-- Model pricing table (USD per million tokens)
-- Input price / Output price
-- mistral-ocr-latest:    $2.00 / $6.00   (user-specified)
-- mistral-small-latest:  $0.10 / $0.30
-- pixtral-12b-2409:      $0.15 / $0.60

-- Update stats RPC to include total_cost_usd
CREATE OR REPLACE FUNCTION get_llm_usage_stats(
  p_function_name TEXT DEFAULT NULL,
  p_model         TEXT DEFAULT NULL,
  p_status        TEXT DEFAULT NULL,
  p_date_from     TIMESTAMPTZ DEFAULT NULL,
  p_date_to       TIMESTAMPTZ DEFAULT NULL,
  p_search        TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT json_build_object(
    'total_calls',      COUNT(*),
    'total_tokens',     COALESCE(SUM(total_tokens), 0),
    'error_count',      COUNT(*) FILTER (WHERE status = 'error'),
    'avg_duration_ms',  ROUND(AVG(duration_ms)),
    'total_cost_usd',   COALESCE(SUM(cost_usd), 0)
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

CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_cost ON llm_usage_logs(cost_usd);
