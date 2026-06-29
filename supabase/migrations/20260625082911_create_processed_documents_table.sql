-- Tracks every document ever processed by the Document Processor.
-- Used to detect re-uploads and offer skip/update options.
CREATE TABLE IF NOT EXISTS processed_documents (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name             TEXT        NOT NULL,
  file_hash             TEXT        NOT NULL,   -- SHA-256 hex of raw file bytes
  file_size             INTEGER     NOT NULL,
  category              TEXT,
  summary               TEXT,
  board_resolution_id   UUID        REFERENCES board_resolutions(id) ON DELETE SET NULL,
  job_id                TEXT,
  processed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (file_hash)
);

CREATE INDEX IF NOT EXISTS idx_processed_docs_hash ON processed_documents(file_hash);
CREATE INDEX IF NOT EXISTS idx_processed_docs_name ON processed_documents(file_name);

ALTER TABLE processed_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_processed_documents" ON processed_documents
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_processed_documents" ON processed_documents
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_processed_documents" ON processed_documents
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_select_processed_documents" ON processed_documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_processed_documents" ON processed_documents
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_processed_documents" ON processed_documents
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
