-- Phase 3 Tranche 3B (mechanism only): Storage bucket + RLS for the knowledge
-- ingestion pipeline. Confirmed empirically (live storage ls check, not assumed) that
-- no bucket/policy for this purpose existed before this migration -- the one existing
-- bucket in this project (database_export_25_08_26) is an unrelated DB export
-- artifact.
--
-- Private bucket (not public) -- raw uploaded files are staff-only, same as the
-- knowledge_documents/knowledge_chunks tables themselves. Object paths are
-- agency-scoped by convention: '{agency_id}/{document_id}/{filename}', enforced by
-- RLS via storage.foldername(name), mirroring the is_agency_staff()/current_agency_id()
-- pattern already used everywhere else rather than inventing a new authorization idiom.
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-uploads', 'knowledge-uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Agency staff manage their agency's knowledge uploads"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'knowledge-uploads'
  AND public.is_agency_staff(auth.uid())
  AND (storage.foldername(name))[1] = public.current_agency_id()::text
)
WITH CHECK (
  bucket_id = 'knowledge-uploads'
  AND public.is_agency_staff(auth.uid())
  AND (storage.foldername(name))[1] = public.current_agency_id()::text
);
