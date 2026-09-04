-- Phase 2 Tranche C: additive vector column + index on knowledge_chunks. Dimension
-- (1536) is endpoint-confirmed from a live OpenAI text-embedding-3-small smoke test, not
-- assumed -- see docs/phase-2-embedding-provider.md. No backfill in this migration:
-- existing chunks get embedding = NULL until the next tranche populates them via the
-- EmbeddingProvider interface (not yet built). No changes to search_agency_knowledge --
-- it keeps ranking by FTS alone until that tranche explicitly swaps it over.
--
-- Purely additive: search_vector (the existing generated tsvector column) and its GIN
-- index (knowledge_chunks_search_idx) are untouched by this migration. FTS retrieval
-- keeps working exactly as before while vector retrieval is built alongside it.
ALTER TABLE public.knowledge_chunks
  ADD COLUMN embedding extensions.vector(1536);

-- HNSW over IVFFlat: IVFFlat's `lists` parameter must be tuned to the row count present
-- *at index-build time*, and it degrades on data added after a sparse initial build
-- without a later REINDEX -- exactly the shape of this rollout ("index now, backfill
-- next tranche"). HNSW has no such prerequisite: it can be created on an empty/sparse
-- column and handles incremental inserts gracefully as embeddings are backfilled
-- afterward. vector_cosine_ops specifically, since the next tranche's
-- search_agency_knowledge rewrite ranks by cosine similarity and the index's operator
-- class must match the query's distance operator (<=>) for the index to actually be used.
CREATE INDEX knowledge_chunks_embedding_hnsw_idx
  ON public.knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

-- No RLS change: adding a column doesn't touch policies. The existing staff-only FOR ALL
-- policy on knowledge_chunks (from 20260902120000) already covers every column on the
-- table, this one included -- nothing to add or update here.
