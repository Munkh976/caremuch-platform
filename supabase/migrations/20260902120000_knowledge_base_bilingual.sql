-- Phase 1 knowledge base: Postgres full-text search, bilingual (en/es), no LLM,
-- no embeddings, no external AI provider. PHI-free by construction (no client_id
-- path anywhere in this schema).
--
-- Isolation model:
--   - agency_id: security boundary, enforced by RLS (staff-only direct table access;
--     everyone else retrieves only through the SECURITY DEFINER function below).
--   - language: correctness boundary (same shape as agency_id, but not a security
--     concern), enforced as a plain filter column + WHERE clause, same as is_active.
--
-- NOT APPLIED YET. Written for review only.

-- ============ ISOLATION: unified "what agency is this user" helper ============
-- Wraps current_agency_id() rather than duplicating its logic, so the two can never
-- disagree. Only adds fallback coverage for caregivers/clients — current_agency_id()
-- already resolves correctly for them today because create-user/enable-client-login/
-- approve-caregiver-registration/link-existing-accounts all keep profiles.agency_id in
-- sync with the caregiver/client's own agency_id (verified clean on the dev DB,
-- 2026-09-02 — see docs/known-issues.md history for the provisioning-path audit).
CREATE OR REPLACE FUNCTION public.my_agency_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    public.current_agency_id(),
    (SELECT agency_id FROM public.caregivers WHERE user_id = auth.uid()),
    (SELECT agency_id FROM public.clients    WHERE user_id = auth.uid())
  )
$$;

-- ============ KNOWLEDGE DOCUMENTS ============
CREATE TABLE public.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id) ON DELETE CASCADE,
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'es')),
  title text NOT NULL,
  category text, -- free label for Phase 1: 'policy' | 'sop' | 'faq' | 'training'
  content text NOT NULL, -- agency knowledge only — never client/family data
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users ON DELETE SET NULL,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Lets knowledge_chunks carry a composite FK to (id, language), making it
  -- structurally impossible for a chunk's language to disagree with its document's.
  CONSTRAINT knowledge_documents_id_language_key UNIQUE (id, language)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_documents TO authenticated;
GRANT ALL ON public.knowledge_documents TO service_role;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

-- Staff-only direct access. Caregivers, clients, and any future intake user never get
-- raw SELECT here — they only ever see content through search_agency_knowledge().
CREATE POLICY "Agency staff manage their agency's knowledge documents"
ON public.knowledge_documents FOR ALL TO authenticated
USING (public.is_agency_staff(auth.uid()) AND agency_id = public.current_agency_id())
WITH CHECK (public.is_agency_staff(auth.uid()) AND agency_id = public.current_agency_id());

CREATE TRIGGER trg_knowledge_documents_updated BEFORE UPDATE ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.knowledge_document_agency_id(_document_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT agency_id FROM public.knowledge_documents WHERE id = _document_id
$$;

-- ============ KNOWLEDGE CHUNKS ============
CREATE TABLE public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  language text NOT NULL CHECK (language IN ('en', 'es')),
  chunk_index integer NOT NULL,
  content text NOT NULL,
  -- Per-language FTS config, derived from this row's own language column. Immutable:
  -- the literal regconfig casts in each branch constant-fold at parse time, and the
  -- two-argument to_tsvector(regconfig, text) form doesn't depend on the mutable
  -- default_text_search_config GUC the way the one-argument form does — this is the
  -- same reasoning that makes the single-language literal form a valid generated
  -- column, just branched on a same-row column instead of a bare literal.
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector(
      CASE language WHEN 'es' THEN 'spanish'::regconfig ELSE 'english'::regconfig END,
      content
    )
  ) STORED,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index),
  -- Structural guarantee: a chunk's language can never disagree with its document's.
  FOREIGN KEY (document_id, language)
    REFERENCES public.knowledge_documents (id, language) ON DELETE CASCADE
);

CREATE INDEX knowledge_chunks_search_idx ON public.knowledge_chunks USING GIN (search_vector);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_chunks TO authenticated;
GRANT ALL ON public.knowledge_chunks TO service_role;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency staff manage their agency's knowledge chunks"
ON public.knowledge_chunks FOR ALL TO authenticated
USING (public.is_agency_staff(auth.uid())
       AND public.knowledge_document_agency_id(document_id) = public.current_agency_id())
WITH CHECK (public.is_agency_staff(auth.uid())
       AND public.knowledge_document_agency_id(document_id) = public.current_agency_id());

-- ============ RETRIEVAL (no LLM, no embeddings) ============
-- SECURITY DEFINER: bypasses the staff-only table RLS above by design, but explicitly
-- re-scopes to the caller's own agency via my_agency_id() inside the query — same
-- defense-in-depth pattern as check_assignment_eligibility()/assign_caregiver_to_shift().
-- plpgsql (not the usual pure-SQL helper style) specifically so an invalid _language
-- fails loudly via RAISE EXCEPTION instead of silently returning zero rows, which would
-- otherwise be indistinguishable from a genuine "no answer found" and corrupt the
-- confidence gate's refuse signal.
CREATE OR REPLACE FUNCTION public.search_agency_knowledge(_query text, _language text, _limit integer DEFAULT 5)
RETURNS TABLE (document_id uuid, document_title text, chunk_id uuid, content text, rank real)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_config regconfig;
BEGIN
  IF _language NOT IN ('en', 'es') THEN
    RAISE EXCEPTION 'Unsupported language: %', _language USING ERRCODE = '22023';
  END IF;
  v_config := CASE _language WHEN 'es' THEN 'spanish'::regconfig ELSE 'english'::regconfig END;

  RETURN QUERY
  SELECT d.id, d.title, c.id, c.content,
         ts_rank(c.search_vector, plainto_tsquery(v_config, _query)) AS rank
  FROM public.knowledge_chunks c
  JOIN public.knowledge_documents d ON d.id = c.document_id
  WHERE d.agency_id = public.my_agency_id()
    AND d.is_active
    AND c.language = _language
    AND c.search_vector @@ plainto_tsquery(v_config, _query)
  ORDER BY rank DESC
  LIMIT _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_agency_knowledge(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_agency_knowledge(text, text, integer) TO authenticated;

-- ============ DEMO PURGE INCLUSION ============
-- Exact existing bodies from supabase/migrations/20260824230927_...sql, with two new
-- DELETE lines added (child-before-parent, mirroring the existing client_care_needs
-- placement) — nothing else in either function body has changed.

CREATE OR REPLACE FUNCTION public.purge_demo_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r jsonb := '{}'::jsonb; n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'system_admin'::app_role) THEN
    RAISE EXCEPTION 'Only platform administrators may purge demo data' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('caremuch.purge_ctx', '1', true);
  DELETE FROM public.events WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('events', n);
  DELETE FROM public.earnings_lines WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('earnings_lines', n);
  DELETE FROM public.time_entries WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('time_entries', n);
  DELETE FROM public.shift_trades WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('shift_trades', n);
  DELETE FROM public.shift_ratings WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('shift_ratings', n);
  DELETE FROM public.shift_assignments WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('shift_assignments', n);
  DELETE FROM public.shifts WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('shifts', n);
  DELETE FROM public.care_requests WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('care_requests', n);
  DELETE FROM public.client_care_needs WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('client_care_needs', n);
  DELETE FROM public.knowledge_chunks WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('knowledge_chunks', n);
  DELETE FROM public.knowledge_documents WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('knowledge_documents', n);
  DELETE FROM public.order_services WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('order_services', n);
  DELETE FROM public.client_orders WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('client_orders', n);
  DELETE FROM public.caregiver_skills WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('caregiver_skills', n);
  DELETE FROM public.caregiver_availability WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('caregiver_availability', n);
  DELETE FROM public.caregiver_certifications WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('caregiver_certifications', n);
  DELETE FROM public.time_off_requests WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('time_off_requests', n);
  DELETE FROM public.clients WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('clients', n);
  DELETE FROM public.caregiver_preferences WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('caregiver_preferences', n);
  DELETE FROM public.caregivers WHERE is_demo AND user_id IS NULL; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('caregivers', n);
  DELETE FROM public.family_contacts WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('family_contacts', n);
  DELETE FROM public.families WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('families', n);
  DELETE FROM public.virtual_office WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('virtual_office', n);
  PERFORM set_config('caremuch.purge_ctx', '0', true);
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_demo_data_dry_run()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE res jsonb; payload jsonb;
BEGIN
  BEGIN
    PERFORM set_config('caremuch.purge_ctx', '1', true);
    res := jsonb_build_object();
    DECLARE n integer;
    BEGIN
      DELETE FROM public.events WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('events', n);
      DELETE FROM public.earnings_lines WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('earnings_lines', n);
      DELETE FROM public.time_entries WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('time_entries', n);
      DELETE FROM public.shift_trades WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('shift_trades', n);
      DELETE FROM public.shift_ratings WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('shift_ratings', n);
      DELETE FROM public.shift_assignments WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('shift_assignments', n);
      DELETE FROM public.shifts WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('shifts', n);
      DELETE FROM public.care_requests WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('care_requests', n);
      DELETE FROM public.client_care_needs WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('client_care_needs', n);
      DELETE FROM public.knowledge_chunks WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('knowledge_chunks', n);
      DELETE FROM public.knowledge_documents WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('knowledge_documents', n);
      DELETE FROM public.order_services WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('order_services', n);
      DELETE FROM public.client_orders WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('client_orders', n);
      DELETE FROM public.caregiver_skills WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('caregiver_skills', n);
      DELETE FROM public.caregiver_availability WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('caregiver_availability', n);
      DELETE FROM public.caregiver_certifications WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('caregiver_certifications', n);
      DELETE FROM public.time_off_requests WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('time_off_requests', n);
      DELETE FROM public.clients WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('clients', n);
      DELETE FROM public.caregiver_preferences WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('caregiver_preferences', n);
      DELETE FROM public.caregivers WHERE is_demo AND user_id IS NULL; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('caregivers', n);
      DELETE FROM public.family_contacts WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('family_contacts', n);
      DELETE FROM public.families WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('families', n);
      DELETE FROM public.virtual_office WHERE is_demo; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('virtual_office', n);
    END;
    res := res || jsonb_build_object('survivors', jsonb_build_object(
        'caregivers_with_login', (SELECT count(*) FROM public.caregivers WHERE user_id IS NOT NULL),
        'caregivers_total', (SELECT count(*) FROM public.caregivers),
        'clients_total', (SELECT count(*) FROM public.clients),
        'shifts_total', (SELECT count(*) FROM public.shifts),
        'shift_assignments_total', (SELECT count(*) FROM public.shift_assignments),
        'time_entries_total', (SELECT count(*) FROM public.time_entries),
        'earnings_lines_total', (SELECT count(*) FROM public.earnings_lines),
        'time_off_total', (SELECT count(*) FROM public.time_off_requests),
        'families_total', (SELECT count(*) FROM public.families),
        'virtual_office_total', (SELECT count(*) FROM public.virtual_office),
        'care_requests_total', (SELECT count(*) FROM public.care_requests),
        'caregiver_preferences_total', (SELECT count(*) FROM public.caregiver_preferences),
        'events_total', (SELECT count(*) FROM public.events),
        'any_nondemo_deleted', false));
    payload := res;
    RAISE EXCEPTION 'DRY_RUN_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'DRY_RUN_ROLLBACK' THEN RAISE; END IF;
  END;
  INSERT INTO public.demo_purge_audit(dry_run, result) VALUES (true, payload);
  RETURN payload;
END;
$function$;
