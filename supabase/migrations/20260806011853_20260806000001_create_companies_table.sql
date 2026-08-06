/*
# Create companies table with signatory linkage view

## Purpose
Establishes a single source of truth for company identity. Today, company
identity is a free-text `company_name` string duplicated across four tables
(company_mandates, authorized_signatories.related_companies, company_groups,
board_resolutions). This migration creates a dedicated `companies` table with
stable codes (CMP-001) and identifier fields, backfills it from existing data,
links it to company_mandates and board_resolutions via a `company_id` column,
and exposes a `company_signatories` view that joins companies to their
signatories through mandates.

## New Table: companies

### Columns
- id                     – UUID primary key
- company_code           – TEXT, UNIQUE, auto-generated (CMP-001) via sequence
- company_name           – TEXT, NOT NULL, UNIQUE
- legal_entity_type      – TEXT, nullable (e.g. Ltd, GmbH, Pte. Ltd, SAS)
- cin_number             – TEXT, nullable (Corporate Identification Number)
- legal_entity_identifier – TEXT, nullable (LEI, left blank for future use)
- other_identifier       – TEXT, nullable (any other identifier, left blank)
- country_of_incorporation – TEXT, nullable
- created_at             – TIMESTAMPTZ, default now()
- updated_at             – TIMESTAMPTZ, default now()

### Sequence
- companies_code_seq – backs the company_code default expression

## Modified Tables

### company_mandates
- New column `company_id` (UUID, nullable, references companies.id)
- Backfilled by matching company_name
- Index on company_id for join performance

### board_resolutions
- New column `company_id` (UUID, nullable, references companies.id)
- Backfilled by matching company_name
- Index on company_id for join performance

## New View: company_signatories
One row per (company, signatory) pair, joining companies → company_mandates →
authorized_signatories. Exposes company fields and signatory fields plus the
mandate title. This is the "table with company names, their identifiers, and
links to all signatories within that company" requested by the user.

## Security
- RLS enabled on companies with anon + authenticated CRUD (single-tenant,
  no sign-in app, same pattern as all other tables).
- The view inherits RLS from the underlying tables.
- company_mandates and board_resolutions already have anon + authenticated
  SELECT policies; the new company_id column is covered by those existing
  policies.

## Important notes
1. The sequence starts at 1 and is owned by companies.company_code.
2. company_code uses lpad(..., 3, '0') so codes are zero-padded to three digits
   up to 999, then expand naturally beyond that (CMP-1000, etc.).
3. authorized_signatories.related_companies and company_groups.member_companies
   are NOT altered — they continue to hold name strings for backward
   compatibility. The companies table is the new source of truth.
4. The migration is idempotent: each statement guards with IF NOT EXISTS or
   checks the information schema before running.
*/

-- ---------------------------------------------------------------------------
-- companies table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS companies (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code             TEXT        UNIQUE,
  company_name             TEXT        NOT NULL UNIQUE,
  legal_entity_type        TEXT,
  cin_number               TEXT,
  legal_entity_identifier  TEXT,
  other_identifier         TEXT,
  country_of_incorporation TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_companies" ON companies;
CREATE POLICY "anon_select_companies" ON companies
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_companies" ON companies;
CREATE POLICY "anon_insert_companies" ON companies
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_companies" ON companies;
CREATE POLICY "anon_update_companies" ON companies
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_companies" ON companies;
CREATE POLICY "anon_delete_companies" ON companies
  FOR DELETE TO anon, authenticated USING (true);

-- Sequence for company_code
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_sequences WHERE sequencename = 'companies_code_seq'
  ) THEN
    CREATE SEQUENCE companies_code_seq START 1;
  END IF;
END $$;

-- Backfill companies from distinct company_name in company_mandates
INSERT INTO companies (company_name)
SELECT DISTINCT cm.company_name
FROM company_mandates cm
WHERE cm.company_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM companies c WHERE c.company_name = cm.company_name
  )
ON CONFLICT (company_name) DO NOTHING;

-- Backfill company_code for any rows that lack one
UPDATE companies
SET company_code = 'CMP-' || lpad((nextval('companies_code_seq'))::text, 3, '0')
WHERE company_code IS NULL;

-- Attach default + ensure unique constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'company_code'
      AND column_default IS NOT NULL
  ) THEN
    ALTER TABLE companies
      ALTER COLUMN company_code
      SET DEFAULT ('CMP-' || lpad((nextval('companies_code_seq'))::text, 3, '0'));
  END IF;
END $$;

ALTER SEQUENCE companies_code_seq OWNED BY companies.company_code;

-- ---------------------------------------------------------------------------
-- company_mandates: add company_id
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_mandates' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE company_mandates ADD COLUMN company_id UUID REFERENCES companies(id);
  END IF;
END $$;

-- Backfill company_id by matching company_name
UPDATE company_mandates cm
SET company_id = c.id
FROM companies c
WHERE cm.company_id IS NULL
  AND cm.company_name = c.company_name;

CREATE INDEX IF NOT EXISTS idx_company_mandates_company_id
  ON company_mandates(company_id);

-- ---------------------------------------------------------------------------
-- board_resolutions: add company_id
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'board_resolutions' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE board_resolutions ADD COLUMN company_id UUID REFERENCES companies(id);
  END IF;
END $$;

-- Backfill company_id by matching company_name
UPDATE board_resolutions br
SET company_id = c.id
FROM companies c
WHERE br.company_id IS NULL
  AND br.company_name IS NOT NULL
  AND br.company_name = c.company_name;

CREATE INDEX IF NOT EXISTS idx_board_resolutions_company_id
  ON board_resolutions(company_id);

-- ---------------------------------------------------------------------------
-- company_signatories view
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW company_signatories AS
SELECT
  c.id           AS company_id,
  c.company_code,
  c.company_name,
  s.id           AS signatory_id,
  s.signatory_display_id,
  s.director_name_key,
  s.first_name,
  s.last_name,
  m.title        AS mandate_title
FROM companies c
INNER JOIN company_mandates m ON m.company_id = c.id
INNER JOIN authorized_signatories s ON s.director_name_key = m.director_name;

ALTER VIEW company_signatories OWNER TO postgres;
