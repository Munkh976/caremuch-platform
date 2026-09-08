import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getEmbeddingProvider } from "../_shared/getEmbeddingProvider.ts";
import { assertPhiSafe } from "../_shared/embeddingProvider.ts";
import { SEMANTIC_MATCH_THRESHOLD, RETRIEVAL_MODE, ANSWER_MODE, GATE3_MATCH_THRESHOLD, GATE3_TOP_K } from "../_shared/searchKnowledgeConfig.ts";
import { detectStructuredPhi } from "../_shared/phiGuard.ts";
import { getLlmProvider } from "../_shared/getLlmProvider.ts";
import { assertLlmPhiSafe } from "../_shared/llmProvider.ts";
import { composeGate3Answer, Gate3Chunk } from "../_shared/gate3Answer.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Tranche 3C, Layer 1: deterministic structured-PII guard over the raw query
    // text, BEFORE it can reach either retrieval mode. Fails closed: any non-SAFE
    // state returns the SAME response shape as a genuine "not grounded" result --
    // deliberately indistinguishable from an ordinary refusal, so this guard cannot
    // be probed as an oracle for what it does or doesn't catch. Query content and
    // the specific match reason are never logged -- only non-content metadata. This
    // guard is load-bearing regardless of which retrieval mode is selected below (a
    // passing result means only "no structured identifier pattern matched," never
    // "proven PHI-free" -- see phiGuard.ts and the Tranche 3C plan §3/§8 for why the
    // residual name/context-PHI risk on this path is accepted only until the 3G
    // retrieval-mode re-measurement, not permanently).
    const guardResult = detectStructuredPhi(query);
    if (guardResult.state !== 'SAFE') {
      console.log('search-knowledge: guard blocked query', { agency_id, language, guard_state: guardResult.state, pattern_class: guardResult.reason });
      return new Response(
        JSON.stringify({ grounded: false, content: null, document_title: null, top_similarity: null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Phase 3 Tranche 3A: match_agency_knowledge's/search_agency_knowledge's anon
    // EXECUTE grants were revoked (20260905090000) -- neither is reachable with the
    // anon key at all, by design (Step 0 of that tranche empirically proved a direct
    // anon RPC call could bypass this Edge Function entirely). This function is now
    // the ONLY path to either, authenticating with service_role for that reason --
    // not to resolve caller identity (there still is none for a genuinely anonymous
    // visitor), purely to reach functions anon/authenticated can no longer call
    // directly.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // _surfaces is hardcoded here, never read from the request body -- the public
    // path may only ever see 'public' content. The browser must never be able to
    // select 'caregiver' by supplying a parameter; this function doesn't look for one.
    // This applies identically to both retrieval modes below, and to both answer
    // modes (Gate 3's retrieval call, added below, reuses this exact same hardcoded
    // scoping -- no new path to caregiver content exists anywhere in this file).
    let data: { content: string; document_title: string; similarity?: number; rank?: number }[] | null;
    let error: { message: string } | null;

    // Phase 3 Gate 3 toggle (docs/phase-3g-light-and-gate3-plan.md): ANSWER_MODE
    // defaults to 'RETRIEVAL', identical behavior to before this file was touched.
    // Only when KNOWLEDGE_ANSWER_MODE='LLM' is explicitly set does this branch run,
    // and even then it uses its OWN threshold (GATE3_MATCH_THRESHOLD) -- it never
    // reads or changes SEMANTIC_MATCH_THRESHOLD, which still governs the RETRIEVAL
    // branch below exactly as it always has.
    if (ANSWER_MODE === 'LLM') {
      const provider = getEmbeddingProvider();
      assertPhiSafe(provider, { requiresPhi: false, description: 'search-knowledge (Gate 3) query embedding' });
      const { embeddings } = await provider.embed(query);
      const queryEmbedding = embeddings[0];

      if (RETRIEVAL_MODE === 'FTS') {
        ({ data, error } = await supabase.rpc('search_agency_knowledge', {
          _query: query,
          _language: language,
          _limit: GATE3_TOP_K,
          _agency_id: agency_id,
          _surfaces: ['public'],
        }));
      } else {
        ({ data, error } = await supabase.rpc('match_agency_knowledge', {
          _query_embedding: queryEmbedding,
          _language: language,
          _limit: GATE3_TOP_K,
          _match_threshold: GATE3_MATCH_THRESHOLD,
          _agency_id: agency_id,
          _surfaces: ['public'],
        }));
      }
      if (error) throw error;

      const chunks: Gate3Chunk[] = (data ?? []).map((d) => ({ document_title: d.document_title, content: d.content }));

      const llmProvider = getLlmProvider();
      assertLlmPhiSafe(llmProvider, { requiresPhi: false, description: 'search-knowledge (Gate 3) answer composition' });
      const gate3Result = await composeGate3Answer(llmProvider, query, chunks);

      return new Response(
        JSON.stringify({
          grounded: gate3Result.answerable,
          content: gate3Result.content,
          // From the LLM's own "From:" citation, NOT chunks[0] -- the model can (and
          // in testing did) draw its composed answer from a lower-ranked retrieved
          // chunk than the top-scoring one, so the top-of-retrieval chunk is not a
          // reliable stand-in for what was actually cited.
          document_title: gate3Result.sourceTitle,
          top_similarity: (data ?? [])[0]?.similarity ?? (data ?? [])[0]?.rank ?? null,
          gate3_model: gate3Result.model,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (RETRIEVAL_MODE === 'FTS') {
      // Tranche 3C retrieval-mode seam: wired and callable, NOT the active default.
      // No external embedding call in this branch at all.
      ({ data, error } = await supabase.rpc('search_agency_knowledge', {
        _query: query,
        _language: language,
        _agency_id: agency_id,
        _surfaces: ['public'],
      }));
    } else {
      const provider = getEmbeddingProvider();

      // requiresPhi: false is a deliberate POLICY declaration, not a technical guarantee --
      // unlike agency-document embedding (the backfill), this call embeds a member of the
      // public's own free-typed question, which has no structural PHI-free guarantee the
      // way knowledge_chunks content does (no client_id path, no FK to any person table).
      // This surface is designed and framed as agency-knowledge Q&A ("Ask me anything
      // about {agency}"), not a PHI-intake channel, and false reflects that intended scope.
      // The Layer 1 guard above is what actually screens the query now; this flag remains
      // false regardless of the guard's result for the same reason as the ingestion path's
      // identical comment -- a passing guard is not a PHI-free proof.
      assertPhiSafe(provider, { requiresPhi: false, description: 'search-knowledge query embedding' });

      const { embeddings } = await provider.embed(query);
      const queryEmbedding = embeddings[0];

      ({ data, error } = await supabase.rpc('match_agency_knowledge', {
        _query_embedding: queryEmbedding,
        _language: language,
        _match_threshold: SEMANTIC_MATCH_THRESHOLD,
        _agency_id: agency_id,
        _surfaces: ['public'],
      }));
    }

    if (error) throw error;

    const top = (data ?? [])[0];

    return new Response(
      JSON.stringify({
        grounded: !!top,
        content: top?.content ?? null,
        document_title: top?.document_title ?? null,
        // Mode-dependent and NOT cross-comparable (cosine similarity vs. ts_rank,
        // different scales) -- diagnostic only, not consumed by the frontend today.
        top_similarity: top?.similarity ?? top?.rank ?? null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in search-knowledge:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
