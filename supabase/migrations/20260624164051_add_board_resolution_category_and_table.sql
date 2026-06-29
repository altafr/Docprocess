-- Add Board Resolution to document categories
INSERT INTO document_categories (user_id, name, description, color, is_default) VALUES
  (NULL, 'Board Resolution', 'Formal resolution passed by a company board of directors, including authorization letters, appointment resolutions, approval minutes, and any decision requiring board sign-off.', 'yellow', true)
ON CONFLICT DO NOTHING;

-- Board resolutions table (stores structured data extracted from processed Board Resolution documents)
CREATE TABLE IF NOT EXISTS board_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_name TEXT NOT NULL DEFAULT '',
  company_name TEXT,
  resolution_number TEXT,
  resolution_date TEXT,
  resolution_type TEXT,
  purpose_summary TEXT,
  key_decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  signatories JSONB NOT NULL DEFAULT '[]'::jsonb,
  authorized_persons JSONB NOT NULL DEFAULT '[]'::jsonb,
  effective_date TEXT,
  expiry_date TEXT,
  full_text TEXT,
  confidence NUMERIC(4,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE board_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_board_resolutions" ON board_resolutions
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_board_resolutions" ON board_resolutions
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_board_resolutions_created_at ON board_resolutions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_board_resolutions_resolution_type ON board_resolutions(resolution_type);
CREATE INDEX IF NOT EXISTS idx_board_resolutions_company_name ON board_resolutions(company_name);
