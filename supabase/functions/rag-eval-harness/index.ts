// Phase 2 Tranche C part 3d, Stage 2: eval harness. Returns the FULL raw ranked list
// from both retrieval paths for one question -- unfiltered by any threshold -- so the
// eval can derive SEMANTIC_MATCH_THRESHOLD, measure the disambiguation score-gap, and
// compare FTS vs semantic from real numbers instead of a single gated answer. This is
// NOT what real users hit (that's search-knowledge, which applies the threshold and
// returns one grounded answer or a refusal) -- this is an internal diagnostic, kept in
// the repo like embedding-provider-check for reuse whenever the eval needs to be re-run
// (a new corpus after Phase 1G, a model change, retuning).
//
// Anon-invokable, same posture as search-knowledge: no auth guard, no write access, no
// PHI exposure beyond what search-knowledge already exposes publicly (agency knowledge
// content only). One question per invocation, driven by an external loop (not batched
// internally) so a single slow/failed call doesn't lose an entire eval run.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getEmbeddingProvider } from "../_shared/getEmbeddingProvider.ts";
import { assertPhiSafe } from "../_shared/embeddingProvider.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Deliberately far above this agency's real chunk count (~16 per language) so nothing
// is ever truncated before per-document aggregation below -- this must return literally
// every chunk, not a top-k sample, or a labeled expected/near-miss document could fall
// off the edge and be misreported as absent when it was just unseen.
const EVAL_LIMIT = 100;

interface RawChunkResult {
  document_title: string;
  chunk_id: string;
  content: string;
  score: number;
}

/** Collapses chunk-level results to one row per DOCUMENT (its best/max-scoring chunk),
 *  sorted descending. A document has 4 chunks; what the ambiguity/near-miss analysis
 *  cares about is document-level competition, not which specific chunk won -- and
 *  returning every document (never just a top-k slice) means a labeled expected_document
 *  or near_miss_document can always be looked up, even if it ranks last. */
function collapseToDocumentBest(chunks: RawChunkResult[]) {
  const bestByDocument = new Map<string, RawChunkResult>();
  for (const chunk of chunks) {
    const existing = bestByDocument.get(chunk.document_title);
    if (!existing || chunk.score > existing.score) {
      bestByDocument.set(chunk.document_title, chunk);
    }
  }
  return Array.from(bestByDocument.values())
    .sort((a, b) => b.score - a.score)
    .map((r) => ({ document_title: r.document_title, score: r.score, best_chunk_id: r.chunk_id }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, language, agency_id } = await req.json();

    if (!query || typeof query !== 'string' || !query.trim()) {
      return new Response(JSON.stringify({ error: 'Missing query' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (language !== 'en' && language !== 'es') {
      return new Response(JSON.stringify({ error: 'Unsupported language' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!agency_id || typeof agency_id !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing agency_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // FTS path: search_agency_knowledge has no built-in threshold -- always returns its
    // full ranked list up to _limit, exactly what the eval needs.
    const { data: ftsData, error: ftsError } = await supabase.rpc('search_agency_knowledge', {
      _query: query,
      _language: language,
      _limit: EVAL_LIMIT,
      _agency_id: agency_id,
    });
    if (ftsError) throw ftsError;

    // Semantic path: same PHI policy declaration as search-knowledge -- eval questions
    // are synthetic, author-written and human-reviewed, not real visitor input, so
    // requiresPhi: false is even more clearly correct here than in production use.
    const provider = getEmbeddingProvider();
    assertPhiSafe(provider, { requiresPhi: false, description: 'rag-eval-harness query embedding' });
    const { embeddings } = await provider.embed(query);
    const queryEmbedding = embeddings[0];

    // _match_threshold: 0 -- unfiltered, we want the whole ranked list, not a gated one.
    const { data: semanticData, error: semanticError } = await supabase.rpc('match_agency_knowledge', {
      _query_embedding: queryEmbedding,
      _language: language,
      _limit: EVAL_LIMIT,
      _match_threshold: 0,
      _agency_id: agency_id,
    });
    if (semanticError) throw semanticError;

    const ftsChunks: RawChunkResult[] = (ftsData ?? []).map((r: any) => ({
      document_title: r.document_title,
      chunk_id: r.chunk_id,
      content: r.content,
      score: r.rank,
    }));
    const semanticChunks: RawChunkResult[] = (semanticData ?? []).map((r: any) => ({
      document_title: r.document_title,
      chunk_id: r.chunk_id,
      content: r.content,
      score: r.similarity,
    }));

    return new Response(
      JSON.stringify({
        // Per-document, every document ranked (never truncated) -- the primary output
        // for eval analysis: labeled expected_document/near_miss_document lookups and
        // the ambiguity score-gap both read from here.
        fts_documents: collapseToDocumentBest(ftsChunks),
        semantic_documents: collapseToDocumentBest(semanticChunks),
        // Raw chunk-level results kept for transparency/debugging -- not the primary
        // analysis unit, per review.
        fts_chunk_results: ftsChunks.map(({ document_title, chunk_id, content, score }) => ({ document_title, chunk_id, content, rank: score })),
        semantic_chunk_results: semanticChunks.map(({ document_title, chunk_id, content, score }) => ({ document_title, chunk_id, content, similarity: score })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in rag-eval-harness:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
