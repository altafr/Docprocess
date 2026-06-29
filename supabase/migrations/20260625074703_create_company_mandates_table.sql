-- Company mandates: per-director banking authority derived from board resolutions.
-- One row per (company, director). Products are unioned across resolutions;
-- signing arrangement/rules come from the most recent effective resolution.

CREATE TABLE IF NOT EXISTS company_mandates (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name          TEXT        NOT NULL,
  director_name         TEXT        NOT NULL,
  title                 TEXT,
  authorized_products   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  signing_arrangement   TEXT        DEFAULT 'unknown',  -- sole | joint | any-two | other | unknown
  signing_rules         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  signature_type        TEXT        DEFAULT 'unknown',  -- wet-ink | digital | unknown
  effective_date        TEXT,
  expiry_date           TEXT,
  source_resolution_ids JSONB       NOT NULL DEFAULT '[]'::jsonb,
  notes                 TEXT,
  last_updated          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_name, director_name)
);

CREATE INDEX IF NOT EXISTS idx_company_mandates_company ON company_mandates(company_name);
CREATE INDEX IF NOT EXISTS idx_company_mandates_director ON company_mandates(director_name);

ALTER TABLE company_mandates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_company_mandates" ON company_mandates
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_company_mandates" ON company_mandates
  FOR SELECT TO authenticated USING (true);

-- Allow frontend users to update notes / annotations without an edge function
CREATE POLICY "anon_update_company_mandates" ON company_mandates
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_update_company_mandates" ON company_mandates
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
