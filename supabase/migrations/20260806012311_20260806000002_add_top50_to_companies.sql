/*
# Add top50 flag to companies table

## Purpose
Adds a boolean `top50` column to the `companies` table so that companies
flagged as "top 50" can be visually distinguished in the UI with a badge.
A handful of existing companies are randomly marked as top50 for demo purposes.

## Modified Table: companies
- New column `top50` (BOOLEAN, NOT NULL, default false)
- Backfilled ~5 random companies with top50 = true

## Security
- No RLS policy changes needed — the column is covered by the existing
  anon + authenticated CRUD policies on the companies table.

## Important notes
1. The column is NOT NULL with a default of false, so all existing and
   future rows automatically get top50 = false unless explicitly set.
2. The migration is idempotent — the DO $$ block checks information_schema
   before adding the column.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'top50'
  ) THEN
    ALTER TABLE companies ADD COLUMN top50 BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Mark ~5 random companies as top50 (only if none are flagged yet)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE top50 = true) THEN
    UPDATE companies
    SET top50 = true
    WHERE id IN (
      SELECT id FROM companies
      ORDER BY random()
      LIMIT 5
    );
  END IF;
END $$;
