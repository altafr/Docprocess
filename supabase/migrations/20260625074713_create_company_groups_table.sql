-- Company groups: user-defined or auto-confirmed groupings of related entities.
-- Only manual/confirmed groups are persisted here; auto-detection is client-side.

CREATE TABLE IF NOT EXISTS company_groups (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name       TEXT        NOT NULL,
  member_companies JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- array of company_name strings
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_groups_name ON company_groups(group_name);

ALTER TABLE company_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_company_groups" ON company_groups
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_company_groups" ON company_groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "anon_insert_company_groups" ON company_groups
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "authenticated_insert_company_groups" ON company_groups
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "anon_update_company_groups" ON company_groups
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_update_company_groups" ON company_groups
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete_company_groups" ON company_groups
  FOR DELETE TO anon USING (true);

CREATE POLICY "authenticated_delete_company_groups" ON company_groups
  FOR DELETE TO authenticated USING (true);
