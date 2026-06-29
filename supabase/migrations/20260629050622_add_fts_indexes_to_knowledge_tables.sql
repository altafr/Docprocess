-- Full-text search vectors for Knowledge Search across all three content tables.
-- Using websearch_to_tsquery (Postgres 11+) for Google-like natural language queries.

-- ─── board_resolutions ───────────────────────────────────────────────────────
ALTER TABLE board_resolutions
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE board_resolutions SET search_vector =
  setweight(to_tsvector('english', coalesce(company_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(resolution_type, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(resolution_number, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(document_name, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(purpose_summary, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(full_text, '')), 'D');

CREATE INDEX IF NOT EXISTS idx_board_resolutions_fts
  ON board_resolutions USING GIN (search_vector);

CREATE OR REPLACE FUNCTION board_resolutions_fts_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.company_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.resolution_type, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.resolution_number, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.document_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.purpose_summary, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.full_text, '')), 'D');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_board_resolutions_fts ON board_resolutions;
CREATE TRIGGER trg_board_resolutions_fts
  BEFORE INSERT OR UPDATE ON board_resolutions
  FOR EACH ROW EXECUTE FUNCTION board_resolutions_fts_update();

-- ─── processed_documents ─────────────────────────────────────────────────────
ALTER TABLE processed_documents
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE processed_documents SET search_vector =
  setweight(to_tsvector('english', coalesce(file_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(summary, '')), 'C');

CREATE INDEX IF NOT EXISTS idx_processed_documents_fts
  ON processed_documents USING GIN (search_vector);

CREATE OR REPLACE FUNCTION processed_documents_fts_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.file_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.category, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'C');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_processed_documents_fts ON processed_documents;
CREATE TRIGGER trg_processed_documents_fts
  BEFORE INSERT OR UPDATE ON processed_documents
  FOR EACH ROW EXECUTE FUNCTION processed_documents_fts_update();

-- ─── company_mandates ────────────────────────────────────────────────────────
ALTER TABLE company_mandates
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE company_mandates SET search_vector =
  setweight(to_tsvector('english', coalesce(company_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(director_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(title, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(signing_arrangement, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(notes, '')), 'C');

CREATE INDEX IF NOT EXISTS idx_company_mandates_fts
  ON company_mandates USING GIN (search_vector);

CREATE OR REPLACE FUNCTION company_mandates_fts_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.company_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.director_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.signing_arrangement, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.notes, '')), 'C');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_mandates_fts ON company_mandates;
CREATE TRIGGER trg_company_mandates_fts
  BEFORE INSERT OR UPDATE ON company_mandates
  FOR EACH ROW EXECUTE FUNCTION company_mandates_fts_update();
