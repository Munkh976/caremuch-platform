-- Phase 2 Tranche C part 3c, Piece 1: additive cosine-similarity retrieval function,
-- alongside (not replacing) the existing FTS search_agency_knowledge. Both stay live so
-- Piece 2's Edge Function and the eval that follows can run head-to-head against real
-- content. Isolation mirrors 20260903140000's search_agency_knowledge EXACTLY -- same
-- agency scoping (COALESCE(_agency_id, my_agency_id())), same language filter, same
-- SECURITY DEFINER + REVOKE-then-GRANT-to-anon pattern, since this function is reached
-- by the same anonymous public knowledge Q&A surface.
--
-- similarity = 1 - cosine distance. The <=> operator is pgvector's cosine distance
-- operator, matching vector_cosine_ops -- the exact operator class the HNSW index
-- (knowledge_chunks_embedding_hnsw_idx, 20260903160000) was built with, so
-- ORDER BY embedding <=> _query_embedding is eligible to use that index. At the current
-- row count (32 chunks) the planner may still reasonably choose a sequential scan
-- anyway -- HNSW's benefit shows up at larger scale, so a seq scan in an EXPLAIN isn't a
-- sign anything is broken, just that the table is still small.
--
-- _match_threshold is a runtime parameter, not hardcoded: the Edge Function reads tau
-- from its own config and passes it in on every call, so retuning tau during the eval
-- is a config change, never a migration. Filtering happens here in SQL (cheaper than
-- returning unfiltered candidates for the Edge Function to discard) using the same
-- expression the ORDER BY already ranks by. DEFAULT 0 (permissive) so an explicit
-- low-value call can still see raw ranked candidates for debugging.
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
         (1 - (c.embedding <=> _query_embedding))::real AS similarity
  FROM public.knowledge_chunks c
  JOIN public.knowledge_documents d ON d.id = c.document_id
  WHERE d.agency_id = COALESCE(_agency_id, public.my_agency_id())
    AND d.is_active
    AND c.language = _language
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding <=> _query_embedding)) >= _match_threshold
  ORDER BY c.embedding <=> _query_embedding ASC
  LIMIT _limit;
END;
$$;

-- Same treatment as search_agency_knowledge (20260903140000): anon reaches this
-- directly from the public, unauthenticated knowledge Q&A surface -- REVOKE FROM
-- PUBLIC first, then GRANT to both authenticated and anon explicitly.
REVOKE ALL ON FUNCTION public.match_agency_knowledge(extensions.vector, text, integer, real, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_agency_knowledge(extensions.vector, text, integer, real, uuid) TO authenticated, anon;
