-- Adds explicit agency scoping to search_agency_knowledge() for the new public/
-- anonymous knowledge Q&A surface on an agency's own page (/a/:slug). The function
-- was only ever designed/tested for an AUTHENTICATED caller: it scopes via
-- my_agency_id(), which resolves from auth.uid(). A genuinely anonymous public
-- visitor has no auth.uid() at all, so my_agency_id() returns NULL and
-- "WHERE d.agency_id = NULL" matches zero rows -- the Q&A surface would refuse every
-- question, for every visitor, always. Worse: a visitor who happens to be logged in
-- as staff/caregiver/client of a DIFFERENT agency while browsing this one would get
-- that other agency's knowledge instead -- a real cross-tenant mismatch, exactly the
-- class of bug this project has been careful about elsewhere (my_agency_id() itself,
-- the provisioning-path audit, etc.).
--
-- Fix mirrors how ConversationSurface.tsx/FamilyIntakeSurface.tsx already solve this
-- for their own public RPCs (flow_session_submit_intake takes an explicit
-- p_agency_id, not relying on auth context): add an optional _agency_id parameter,
-- COALESCE'd ahead of my_agency_id() so every existing authenticated caller (there
-- are none in the frontend yet, but the SQL-editor testing pattern from Path A relies
-- on my_agency_id() resolving from the session) behaves identically when the new
-- parameter is omitted.
--
-- Adding a parameter changes the function's identity in Postgres -- CREATE OR REPLACE
-- cannot widen an existing signature in place, it creates a second, separate overload
-- alongside the old one (this bit exactly once before in this project:
-- flow_session_submit_intake needed an explicit DROP FUNCTION of its old 8-parameter
-- overload in 20260823222359 after gaining p_agency_id/p_virtual_office_id). Same
-- treatment here: drop the old 3-parameter signature explicitly so only one version
-- of this function exists, avoiding any "function is not unique" ambiguity from
-- PostgREST resolving which overload a 2-or-3-argument call should hit.

DROP FUNCTION IF EXISTS public.search_agency_knowledge(text, text, integer);

CREATE OR REPLACE FUNCTION public.search_agency_knowledge(
  _query text, _language text, _limit integer DEFAULT 5, _agency_id uuid DEFAULT NULL
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
  v_config := CASE _language WHEN 'es' THEN 'spanish'::regconfig ELSE 'english'::regconfig END;

  -- Build an OR-based tsquery from the question itself (same stemming/stopword pipeline
  -- to_tsvector uses for indexing, combined with | instead of plainto_tsquery's implicit
  -- &) so a natural question doesn't fail just because it phrases a concept differently
  -- than the document. Works purely off _query text; never inspects document content.
  --
  -- Consequence: the hard "zero rows" gate is now much weaker -- it only excludes
  -- questions sharing ZERO vocabulary with anything in scope, not "any missing word"
  -- the way AND accidentally did. The rank threshold, tuned from the probe's observed
  -- distribution (not assumed here), is what actually separates genuine hits from
  -- incidental single-word overlap.
  --
  -- Defensive sanitizing: to_tsvector's parser can preserve punctuation like ':', '/',
  -- '@', '.' inside a single lexeme for certain token classes (URLs, emails, hostnames,
  -- version numbers) -- and ':' is tsquery's weight/prefix operator, so an unsanitized
  -- lexeme could make to_tsquery's strict parser throw a syntax error on some future
  -- document's content. Strip to letters (explicitly including the accented Spanish set
  -- -- NOT the POSIX [:alnum:] class, which is locale-dependent and could otherwise
  -- silently strip accents from Spanish lexemes under a C-locale database), digits, and
  -- underscore before building the query string. This can only narrow a match, never
  -- invent a false one.
  v_lexemes := (
    SELECT array_agg(cleaned) FROM (
      SELECT regexp_replace(lex, '[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ_]', '', 'g') AS cleaned
      FROM unnest(tsvector_to_array(to_tsvector(v_config, _query))) AS lex
    ) s
    WHERE cleaned <> ''
  );

  IF v_lexemes IS NULL OR array_length(v_lexemes, 1) IS NULL THEN
    RETURN; -- query was empty, entirely stop-words, or sanitized to nothing
  END IF;

  -- Backstop: even after sanitizing, never let a malformed tsquery propagate an error
  -- to the caller -- a missed match is an acceptable failure mode here, a thrown
  -- exception from the retrieval path is not.
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
    AND c.language = _language
    AND c.search_vector @@ v_tsquery
  ORDER BY rank DESC
  LIMIT _limit;
END;
$$;

-- Anonymous public visitors call this directly (no auth.uid() at all) -- unlike the
-- original grant (authenticated only), this must also be usable by anon. Still safe
-- for anon: read-only, agency-scoped by the explicit parameter, no PHI in scope
-- (knowledge_documents/knowledge_chunks are agency knowledge only, never client data).
REVOKE ALL ON FUNCTION public.search_agency_knowledge(text, text, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_agency_knowledge(text, text, integer, uuid) TO authenticated, anon;
