-- Fixes match_agency_knowledge (20260904090000): "operator does not exist: extensions.vector
-- <=> extensions.vector". pgvector was installed WITH SCHEMA extensions (matching the
-- existing pgcrypto convention), but this function runs with SET search_path = public --
-- correct, and deliberately not widened, matching every other SECURITY DEFINER function in
-- this codebase. Unlike functions, an infix operator like <=> can't be schema-qualified with
-- dot notation (there is no "extensions.<=>" call syntax) -- Postgres's actual mechanism for
-- this is the OPERATOR(schema.opname) qualifier, used here instead of widening search_path.
-- Function body only -- no schema/grant change.
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
