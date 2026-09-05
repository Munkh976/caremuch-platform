-- Phase 3 Tranche 3A: establish the PUBLIC/CAREGIVER surface boundary. Schema + RPC
-- signatures + anon-grant revocation ship together in ONE migration, coordinated with
-- corresponding changes to search-knowledge/index.ts and rag-eval-harness/index.ts
-- (switched from SUPABASE_ANON_KEY to SUPABASE_SERVICE_ROLE_KEY) -- these do not work
-- independently of each other. Rollback: supabase/migrations/20260905080000 (already
-- empirically verified to parse/execute against this database).
--
-- Root justification, confirmed empirically before this migration was written (not
-- assumed): match_agency_knowledge/search_agency_knowledge are GRANTed directly to
-- anon. A raw, unauthenticated POST to /rest/v1/rpc/search_agency_knowledge with only
-- the public anon key returned real chunk content, completely bypassing
-- search-knowledge. Adding a surface column/parameter without also closing this
-- direct-RPC path would be a security boundary enforced "by convention" (assuming
-- every caller goes through the Edge Function), not "by architecture" -- exactly the
-- distinction the CareMuch Phase 2 RAG Architecture Decision doc requires. This
-- migration closes both halves together.

-- ============ 1. SCHEMA: knowledge_documents.surface ============
-- Explicit backfill, not a DEFAULT-inherited classification -- a DEFAULT and an
-- explicit UPDATE can silently diverge if migration ordering ever shifts; proving the
-- classification (not inheriting it) is the whole point of doing this in three steps.

-- Step 1a: add nullable, no default yet.
ALTER TABLE public.knowledge_documents ADD COLUMN surface text;

-- Step 1b: EXPLICIT backfill. The Phase 2 seed corpus (Attendance/Call-Off, PTO,
-- Dementia SOP, Medication Guidelines) is private caregiver-policy content per the
-- Architecture Decision doc's own §2 classification -- every existing row is
-- caregiver, unconditionally, stated here rather than left to a default.
UPDATE public.knowledge_documents SET surface = 'caregiver' WHERE surface IS NULL;

-- Step 1c: NOT NULL now enforceable -- Postgres validates against real data at this
-- point; if the backfill above ever missed a row, this statement itself would fail
-- loudly rather than letting an unclassified row through.
ALTER TABLE public.knowledge_documents ALTER COLUMN surface SET NOT NULL;

-- Step 1d: CHECK constraint.
ALTER TABLE public.knowledge_documents
  ADD CONSTRAINT knowledge_documents_surface_check CHECK (surface IN ('public','caregiver'));

-- Step 1e: DEFAULT set LAST -- governs only rows inserted from this point forward,
-- never the backfill above. 'caregiver' (the restrictive value), not 'public": a
-- document that fails to get explicitly classified (a bug, a missed field on insert)
-- becomes invisible to the public surface by default, never accidentally exposed.
ALTER TABLE public.knowledge_documents ALTER COLUMN surface SET DEFAULT 'caregiver';

-- knowledge_chunks: NO change. A chunk's authorization is a single JOIN-and-filter on
-- its parent document's surface (identical pattern to the existing agency_id filter)
-- -- this is what keeps this a document-level classification, not per-chunk tagging.

-- ============ 2. RPC: match_agency_knowledge gains _surfaces ============
-- _surfaces text[] is REQUIRED, NO DEFAULT -- deliberately. Every caller, present and
-- future (including Phase 4's authenticated-caregiver path), MUST pass it explicitly.
-- A forgotten parameter must be a hard Postgres error (missing argument), never a
-- silent fall-through to some default scope. This is the same reasoning already
-- applied to the column's own safe-default direction, one layer up: no default at all
-- is safer than any default, in either direction, because it can't be forgotten
-- silently.
DROP FUNCTION IF EXISTS public.match_agency_knowledge(extensions.vector, text, integer, real, uuid);

CREATE OR REPLACE FUNCTION public.match_agency_knowledge(
  _query_embedding extensions.vector(1536),
  _language text,
  _limit integer DEFAULT 5,
  _match_threshold real DEFAULT 0,
  _agency_id uuid DEFAULT NULL,
  _surfaces text[] DEFAULT NULL  -- see note below: DEFAULT NULL only to satisfy
                                  -- Postgres's "no required param after an optional
                                  -- one" ordering rule; validated as NOT NULL/non-empty
                                  -- inside the body, so omitting it is still a hard
                                  -- runtime failure, not a silent pass-through.
)
RETURNS TABLE (document_id uuid, document_title text, chunk_id uuid, content text, similarity real)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _language NOT IN ('en', 'es') THEN
    RAISE EXCEPTION 'Unsupported language: %', _language USING ERRCODE = '22023';
  END IF;

  IF _surfaces IS NULL OR array_length(_surfaces, 1) IS NULL
     OR NOT (_surfaces <@ ARRAY['public','caregiver']::text[]) THEN
    RAISE EXCEPTION 'Invalid surfaces: % -- must be a non-empty subset of {public,caregiver}, and callers must pass this explicitly (no default)', _surfaces
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT d.id, d.title, c.id, c.content,
         (1 - (c.embedding OPERATOR(extensions.<=>) _query_embedding))::real AS similarity
  FROM public.knowledge_chunks c
  JOIN public.knowledge_documents d ON d.id = c.document_id
  WHERE d.agency_id = COALESCE(_agency_id, public.my_agency_id())
    AND d.is_active
    AND d.surface = ANY(_surfaces)
    AND c.language = _language
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding OPERATOR(extensions.<=>) _query_embedding)) >= _match_threshold
  ORDER BY c.embedding OPERATOR(extensions.<=>) _query_embedding ASC
  LIMIT _limit;
END;
$$;

-- ============ 3. RPC: search_agency_knowledge gains _surfaces (same treatment) ============
DROP FUNCTION IF EXISTS public.search_agency_knowledge(text, text, integer, uuid);

CREATE OR REPLACE FUNCTION public.search_agency_knowledge(
  _query text, _language text, _limit integer DEFAULT 5, _agency_id uuid DEFAULT NULL,
  _surfaces text[] DEFAULT NULL  -- see match_agency_knowledge's note: validated as
                                  -- required inside the body.
)
RETURNS TABLE (document_id uuid, document_title text, chunk_id uuid, content text, rank real)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_config regconfig;
  v_lexemes text[];
  v_tsquery tsquery;
BEGIN
  IF _language NOT IN ('en', 'es') THEN
    RAISE EXCEPTION 'Unsupported language: %', _language USING ERRCODE = '22023';
  END IF;

  IF _surfaces IS NULL OR array_length(_surfaces, 1) IS NULL
     OR NOT (_surfaces <@ ARRAY['public','caregiver']::text[]) THEN
    RAISE EXCEPTION 'Invalid surfaces: % -- must be a non-empty subset of {public,caregiver}, and callers must pass this explicitly (no default)', _surfaces
      USING ERRCODE = '22023';
  END IF;

  v_config := CASE _language WHEN 'es' THEN 'spanish'::regconfig ELSE 'english'::regconfig END;

  v_lexemes := (
    SELECT array_agg(cleaned) FROM (
      SELECT regexp_replace(lex, '[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ_]', '', 'g') AS cleaned
      FROM unnest(tsvector_to_array(to_tsvector(v_config, _query))) AS lex
    ) s
    WHERE cleaned <> ''
  );

  IF v_lexemes IS NULL OR array_length(v_lexemes, 1) IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    v_tsquery := to_tsquery(v_config, array_to_string(v_lexemes, ' | '));
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  RETURN QUERY
  SELECT d.id, d.title, c.id, c.content,
         ts_rank(c.search_vector, v_tsquery) AS rank
  FROM public.knowledge_chunks c
  JOIN public.knowledge_documents d ON d.id = c.document_id
  WHERE d.agency_id = COALESCE(_agency_id, public.my_agency_id())
    AND d.is_active
    AND d.surface = ANY(_surfaces)
    AND c.language = _language
    AND c.search_vector @@ v_tsquery
  ORDER BY rank DESC
  LIMIT _limit;
END;
$$;

-- ============ 4. GRANTS: the actual security fix ============
-- REVOKE anon entirely. Confirmed empirically (Step 0, this session) that anon could
-- call these RPCs directly via /rest/v1/rpc/..., bypassing search-knowledge and
-- whatever it hardcodes -- a surface column/parameter is meaningless as a security
-- boundary if the RPC itself remains independently, anonymously callable. Going
-- forward, the ONLY path to these functions is code holding service_role privilege
-- (search-knowledge, rag-eval-harness -- both updated in this same coordinated change
-- to authenticate with SUPABASE_SERVICE_ROLE_KEY instead of SUPABASE_ANON_KEY).
REVOKE ALL ON FUNCTION public.match_agency_knowledge(extensions.vector, text, integer, real, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_agency_knowledge(extensions.vector, text, integer, real, uuid, text[]) TO service_role;

REVOKE ALL ON FUNCTION public.search_agency_knowledge(text, text, integer, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_agency_knowledge(text, text, integer, uuid, text[]) TO service_role;
