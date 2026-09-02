-- Fixes search_agency_knowledge(): plainto_tsquery ANDs all terms, so a natural
-- question failed to match whenever ANY word differed from the document's wording
-- (e.g. "earn" vs. the document's "accrue" -> zero rows despite "hours"/"PTO" matching
-- perfectly). Confirmed via a small bilingual probe seed (20260902130000). Function
-- only -- no schema change.

CREATE OR REPLACE FUNCTION public.search_agency_knowledge(_query text, _language text, _limit integer DEFAULT 5)
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
  WHERE d.agency_id = public.my_agency_id()
    AND d.is_active
    AND c.language = _language
    AND c.search_vector @@ v_tsquery
  ORDER BY rank DESC
  LIMIT _limit;
END;
$$;
