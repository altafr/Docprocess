/*
# Create authorized_signatories table

## Purpose
A standalone directory of individuals who appear as authorized signatories
across all processed board resolutions. Each row represents one unique person.
The table is designed to be both auto-populated (synced from company_mandates)
and manually enriched by operations staff with KYC / identity details that do
not exist in board resolution documents.

## New Table: authorized_signatories

### Columns
- id                  – UUID primary key
- director_name_key   – Canonical name from company_mandates (unique), used as
                         the sync anchor between the two tables. NULL for
                         manually-created records.
- first_name          – Given name (auto-split from director_name on sync,
                         editable by staff)
- last_name           – Family name (auto-split from director_name on sync,
                         editable by staff)
- id_type             – Type of identity document, e.g. Passport, HKID,
                         National ID (manual entry)
- id_number           – Document reference number (manual entry)
- id_expiry_date      – Identity document expiry date (manual entry, free-text
                         to support multiple date formats)
- nationality         – Country of nationality (manual entry)
- signature_url       – Public URL to the signature image in Supabase Storage.
                         Populated automatically from company_mandates on sync;
                         overridable by staff.
- email_address       – Contact email (manual entry)
- residential_address – Residential address (manual entry)
- date_of_birth       – Date of birth (manual entry, free-text)
- related_companies   – TEXT array of company names this person is authorized
                         to act for. Merged automatically from company_mandates
                         on sync.
- source_resolution_ids – TEXT array of board_resolutions UUIDs that mention
                           this signatory. Populated on sync.
- created_at          – Row creation timestamp
- last_updated        – Timestamp updated on every edit or sync

## Security
- RLS enabled.
- Policies scoped to anon + authenticated (no sign-in required by this app).
- All four CRUD operations permitted so the anon-key frontend can read, create,
  update, and delete records.

## Indexes
- idx_authorized_signatories_director_name_key  – fast sync lookups
- idx_authorized_signatories_last_name           – sorting/searching by surname
*/

CREATE TABLE IF NOT EXISTS authorized_signatories (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  director_name_key     TEXT        UNIQUE,
  first_name            TEXT,
  last_name             TEXT,
  id_type               TEXT,
  id_number             TEXT,
  id_expiry_date        TEXT,
  nationality           TEXT,
  signature_url         TEXT,
  email_address         TEXT,
  residential_address   TEXT,
  date_of_birth         TEXT,
  related_companies     TEXT[]      NOT NULL DEFAULT '{}',
  source_resolution_ids TEXT[]      NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE authorized_signatories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_authorized_signatories" ON authorized_signatories;
CREATE POLICY "anon_select_authorized_signatories" ON authorized_signatories
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_authorized_signatories" ON authorized_signatories;
CREATE POLICY "anon_insert_authorized_signatories" ON authorized_signatories
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_authorized_signatories" ON authorized_signatories;
CREATE POLICY "anon_update_authorized_signatories" ON authorized_signatories
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_authorized_signatories" ON authorized_signatories;
CREATE POLICY "anon_delete_authorized_signatories" ON authorized_signatories
  FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_authorized_signatories_director_name_key
  ON authorized_signatories (director_name_key);

CREATE INDEX IF NOT EXISTS idx_authorized_signatories_last_name
  ON authorized_signatories (last_name);
