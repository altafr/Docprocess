-- Table: stores extracted signature/seal/stamp image metadata
CREATE TABLE IF NOT EXISTS document_signatures (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_resolution_id  UUID        REFERENCES board_resolutions(id) ON DELETE CASCADE,
  person_name          TEXT,
  company_name         TEXT,
  element_type         TEXT        NOT NULL CHECK (element_type IN ('signature', 'seal', 'stamp')),
  signature_type       TEXT        NOT NULL DEFAULT 'unknown', -- wet-ink | digital | unknown
  storage_path         TEXT        NOT NULL,
  storage_url          TEXT,
  page_number          INTEGER     NOT NULL DEFAULT 1,
  bounding_box         JSONB,      -- {x, y, w, h} as 0-100 percentages of page
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_sigs_br      ON document_signatures(board_resolution_id);
CREATE INDEX IF NOT EXISTS idx_doc_sigs_person  ON document_signatures(person_name);
CREATE INDEX IF NOT EXISTS idx_doc_sigs_company ON document_signatures(company_name);

ALTER TABLE document_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_document_signatures" ON document_signatures
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_document_signatures" ON document_signatures
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_delete_document_signatures" ON document_signatures
  FOR DELETE TO anon USING (true);
CREATE POLICY "authenticated_select_document_signatures" ON document_signatures
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_document_signatures" ON document_signatures
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_delete_document_signatures" ON document_signatures
  FOR DELETE TO authenticated USING (true);

-- Supabase Storage bucket for signature/seal/stamp PNG crops
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signatures', 'signatures', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- RLS for storage objects
CREATE POLICY "signatures_bucket_select" ON storage.objects
  FOR SELECT TO anon USING (bucket_id = 'signatures');
CREATE POLICY "signatures_bucket_insert" ON storage.objects
  FOR INSERT TO anon WITH CHECK (bucket_id = 'signatures');
CREATE POLICY "signatures_bucket_delete" ON storage.objects
  FOR DELETE TO anon USING (bucket_id = 'signatures');
CREATE POLICY "signatures_bucket_select_auth" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'signatures');
CREATE POLICY "signatures_bucket_insert_auth" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'signatures');
