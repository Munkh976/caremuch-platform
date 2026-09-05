-- PRE-FLIGHT GATE 1 for Tranche 3A (surface boundary). This file IS the rollback
-- script for the upcoming 3A migration, applied here FIRST -- before 3A exists --
-- specifically because at this exact moment every statement below is a harmless
-- no-op-equivalent restore of the CURRENT live state (old RPC signatures/bodies,
-- anon still granted, no surface column exists to drop). Applying it now is a real,
-- empirical proof that this exact SQL parses and executes cleanly against this
-- database -- not a claim based on careful reading alone.
--
-- TO ACTUALLY ROLL BACK AFTER 3A HAS APPLIED: copy this file's content into a new
-- migration with a fresh timestamp and push it. This file itself will already be
-- marked applied in migration history and will not re-run.

-- ============ 1. Drop the surface column (no-op now -- doesn't exist yet) ============
ALTER TABLE public.knowledge_documents DROP COLUMN IF EXISTS surface;

-- ============ 2. Restore match_agency_knowledge to its current (pre-3A) signature ============
-- Drops the 3A 6-arg signature if it exists (no-op right now -- it doesn't exist yet).
DROP FUNCTION IF EXISTS public.match_agency_knowledge(extensions.vector, text, integer, real, uuid, text[]);

-- Recreates the exact current live body verbatim (from 20260904091000).
CREATE OR REPLACE FUNCTION public.match_agency_knowledge(
  _query_embedding extensions.vector(1536),
  _language text,
  _limit integer DEFAULT 5,
  _match_threshold real DEFAULT 0,
  _agency_id uuid DEFAULT NULL
)
RETURNS TABLE (document_id uuid, document_title text, chunk_id uuid, content text, similarity real)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _language NOT IN ('en', 'es') THEN
    RAISE EXCEPTION 'Unsupported language: %', _language USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT d.id, d.title, c.id, c.content,
         (1 - (c.embedding OPERATOR(extensions.<=>) _query_embedding))::real AS similarity
  FROM public.knowledge_chunks c
  JOIN public.knowledge_documents d ON d.id = c.document_id
  WHERE d.agency_id = COALESCE(_agency_id, public.my_agency_id())
    AND d.is_active
    AND c.language = _language
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding OPERATOR(extensions.<=>) _query_embedding)) >= _match_threshold
  ORDER BY c.embedding OPERATOR(extensions.<=>) _query_embedding ASC
  LIMIT _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.match_agency_knowledge(extensions.vector, text, integer, real, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_agency_knowledge(extensions.vector, text, integer, real, uuid) TO authenticated, anon;

-- ============ 3. Restore search_agency_knowledge to its current (pre-3A) signature ============
-- Drops the 3A 5-arg signature if it exists (no-op right now -- it doesn't exist yet).
DROP FUNCTION IF EXISTS public.search_agency_knowledge(text, text, integer, uuid, text[]);

-- Recreates the exact current live body verbatim (from 20260903140000).
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
    AND c.language = _language
    AND c.search_vector @@ v_tsquery
  ORDER BY rank DESC
  LIMIT _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_agency_knowledge(text, text, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_agency_knowledge(text, text, integer, uuid) TO authenticated, anon;
