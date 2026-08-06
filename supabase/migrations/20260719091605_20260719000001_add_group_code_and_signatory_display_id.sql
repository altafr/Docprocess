/*
# Add group_code and signatory_display_id for scoping and bulk-update verification

## Purpose
Supports two new product features:
1. Group-level scoping of the Mandates tab (Ask 1) and the Authorized Signatories
   tab filter (Ask 2). The existing `company_groups` table gains a short, stable
   `group_code` (e.g. GRP-001) so users can identify groups during the double-check
   step of bulk updates.
2. Bulk update of a signer's name across multiple company mandates (Ask 3, Approach
   A). The `authorized_signatories` table gains a short, stable
   `signatory_display_id` (e.g. SIG-001) shown in the bulk-update confirmation so
   users can verify exactly which records will be updated.

## Changes

### company_groups
- New column `group_code` (TEXT, UNIQUE). Auto-assigned on insert via a default
  expression `('GRP-' || lpad((nextval('company_groups_code_seq'))::text, 3, '0'))`
  backed by a dedicated sequence `company_groups_code_seq`. The default is applied
  only when the client omits the value, so callers may still set a custom code.
- New GIN index `idx_company_groups_member_companies_gin` on `member_companies`
  to accelerate `company_name IN member_companies` containment lookups used by the
  Mandates tab scope filter.

### authorized_signatories
- New column `signatory_display_id` (TEXT, UNIQUE). Auto-assigned on insert via a
  default expression `('SIG-' || lpad((nextval('authorized_signatories_code_seq'))::text, 3, '0'))`
  backed by a dedicated sequence `authorized_signatories_code_seq`.
- Existing rows are backfilled with sequential codes.

## Security
- No new tables. No RLS policy changes — the existing policies on both tables
  already permit anon + authenticated CRUD (intentionally public single-tenant
  app with no sign-in). Verified against the existing migrations.
- The new columns inherit no additional constraints beyond UNIQUE, which is
  sufficient because the default expression guarantees non-null, unique values.

## Important notes
1. Both sequences start at 1 and are owned by their respective tables so a row
   drop does not leak sequence state.
2. The default expressions use `lpad(..., 3, '0')` so codes are zero-padded to
   three digits up to 999, then expand naturally beyond that (GRP-1000, etc.).
3. The migration is idempotent: each statement guards with IF NOT EXISTS or
   checks the information schema before running.
*/

-- ---------------------------------------------------------------------------
-- company_groups: group_code + GIN index
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_groups' AND column_name = 'group_code'
  ) THEN
    ALTER TABLE company_groups ADD COLUMN group_code TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_sequences WHERE sequencename = 'company_groups_code_seq'
  ) THEN
    CREATE SEQUENCE company_groups_code_seq START 1;
  END IF;
END $$;

-- Backfill group_code for any existing rows that lack one
UPDATE company_groups
SET group_code = 'GRP-' || lpad((nextval('company_groups_code_seq'))::text, 3, '0')
WHERE group_code IS NULL;

-- Attach default + unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_groups' AND column_name = 'group_code'
      AND column_default IS NOT NULL
  ) THEN
    ALTER TABLE company_groups
      ALTER COLUMN group_code
      SET DEFAULT ('GRP-' || lpad((nextval('company_groups_code_seq'))::text, 3, '0'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_groups_group_code_key'
  ) THEN
    ALTER TABLE company_groups ADD CONSTRAINT company_groups_group_code_key UNIQUE (group_code);
  END IF;
END $$;

ALTER SEQUENCE company_groups_code_seq OWNED BY company_groups.group_code;

CREATE INDEX IF NOT EXISTS idx_company_groups_member_companies_gin
  ON company_groups USING GIN (member_companies);

-- ---------------------------------------------------------------------------
-- authorized_signatories: signatory_display_id
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'authorized_signatories' AND column_name = 'signatory_display_id'
  ) THEN
    ALTER TABLE authorized_signatories ADD COLUMN signatory_display_id TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_sequences WHERE sequencename = 'authorized_signatories_code_seq'
  ) THEN
    CREATE SEQUENCE authorized_signatories_code_seq START 1;
  END IF;
END $$;

-- Backfill signatory_display_id for existing rows that lack one
UPDATE authorized_signatories
SET signatory_display_id = 'SIG-' || lpad((nextval('authorized_signatories_code_seq'))::text, 3, '0')
WHERE signatory_display_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'authorized_signatories' AND column_name = 'signatory_display_id'
      AND column_default IS NOT NULL
  ) THEN
    ALTER TABLE authorized_signatories
      ALTER COLUMN signatory_display_id
      SET DEFAULT ('SIG-' || lpad((nextval('authorized_signatories_code_seq'))::text, 3, '0'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'authorized_signatories_signatory_display_id_key'
  ) THEN
    ALTER TABLE authorized_signatories
      ADD CONSTRAINT authorized_signatories_signatory_display_id_key UNIQUE (signatory_display_id);
  END IF;
END $$;

ALTER SEQUENCE authorized_signatories_code_seq OWNED BY authorized_signatories.signatory_display_id;
