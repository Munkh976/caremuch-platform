-- Phase 3 Tranche 3B (mechanism only): additive ingestion-pipeline columns on
-- knowledge_documents, deliberately fenced OUT of Tranche 3A (which was surface-column
-- only). knowledge_chunks is unchanged -- a chunk either exists with a real embedding
-- or it doesn't; no per-chunk status is needed.

-- source_storage_path / file_format: nullable -- hand-authored/seed documents (the
-- existing 8) have neither, and that's correct, not a gap to backfill.
ALTER TABLE public.knowledge_documents ADD COLUMN source_storage_path text;
ALTER TABLE public.knowledge_documents ADD COLUMN file_format text
  CHECK (file_format IS NULL OR file_format IN ('pdf', 'docx', 'txt'));

-- ingestion_error: nullable, populated only when ingestion_status = 'failed'.
ALTER TABLE public.knowledge_documents ADD COLUMN ingestion_error text;

-- superseded_by: versioning pointer, old document -> its replacement. Nullable; a
-- document row is only superseded when explicitly replaced via the ingestion UI's
-- "replace" action (see ingest-knowledge-document), never inferred from filename or
-- content matching.
ALTER TABLE public.knowledge_documents ADD COLUMN superseded_by uuid REFERENCES public.knowledge_documents(id);

-- ingestion_status: NOT NULL, explicit backfill before the constraint (same discipline
-- as 3A's surface column, even though the safety direction differs here -- 'ready'
-- isn't a security-sensitive value the way 'caregiver' was, but explicit backfill
-- keeps the same auditable "prove it, don't inherit it" pattern).
ALTER TABLE public.knowledge_documents ADD COLUMN ingestion_status text;
UPDATE public.knowledge_documents SET ingestion_status = 'ready' WHERE ingestion_status IS NULL;
ALTER TABLE public.knowledge_documents ALTER COLUMN ingestion_status SET NOT NULL;
ALTER TABLE public.knowledge_documents
  ADD CONSTRAINT knowledge_documents_ingestion_status_check
  CHECK (ingestion_status IN ('pending','extracting','chunking','embedding','ready','failed'));
ALTER TABLE public.knowledge_documents ALTER COLUMN ingestion_status SET DEFAULT 'pending';
-- Note: DEFAULT is 'pending', NOT 'ready' -- it governs only rows inserted going
-- forward, and a newly-inserted pipeline row genuinely starts pending, not ready. The
-- explicit backfill above (unaffected by this default, already applied) is what makes
-- the existing 8 seed documents 'ready', which is the true, already-correct state.
