CREATE TABLE IF NOT EXISTS document_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'failed')),
  file_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE document_processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_jobs" ON document_processing_jobs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "insert_own_jobs" ON document_processing_jobs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "update_own_jobs" ON document_processing_jobs
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_own_jobs" ON document_processing_jobs
  FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_document_processing_jobs_created_at
  ON document_processing_jobs (created_at DESC);
