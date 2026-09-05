import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getEmbeddingProvider } from "../_shared/getEmbeddingProvider.ts";
import { assertPhiSafe } from "../_shared/embeddingProvider.ts";
import { SEMANTIC_MATCH_THRESHOLD } from "../_shared/searchKnowledgeConfig.ts";

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

    const provider = getEmbeddingProvider();

    // requiresPhi: false is a deliberate POLICY declaration, not a technical guarantee --
    // unlike agency-document embedding (the backfill), this call embeds a member of the
    // public's own free-typed question, which has no structural PHI-free guarantee the
    // way knowledge_chunks content does (no client_id path, no FK to any person table).
    // This surface is designed and framed as agency-knowledge Q&A ("Ask me anything
    // about {agency}"), not a PHI-intake channel, and false reflects that intended scope
    // -- it does not detect or block PHI a visitor might type anyway. Revisit before
    // ever treating this surface as PHI-safe for arbitrary user input; out of scope for
    // Phase 2.
    assertPhiSafe(provider, { requiresPhi: false, description: 'search-knowledge query embedding' });

    const { embeddings } = await provider.embed(query);
    const queryEmbedding = embeddings[0];

    // Phase 3 Tranche 3A: match_agency_knowledge's anon EXECUTE grant was revoked
    // (20260905090000) -- it is no longer reachable with the anon key at all, by
    // design (Step 0 of that tranche empirically proved a direct anon RPC call could
    // bypass this Edge Function entirely). This function is now the ONLY path to it,
    // authenticating with service_role for that reason -- not to resolve caller
    // identity (there still is none for a genuinely anonymous visitor), purely to
    // reach a function anon/authenticated can no longer call directly.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // _surfaces is hardcoded here, never read from the request body -- the public
    // path may only ever see 'public' content. The browser must never be able to
    // select 'caregiver' by supplying a parameter; this function doesn't look for one.
    const { data, error } = await supabase.rpc('match_agency_knowledge', {
      _query_embedding: queryEmbedding,
      _language: language,
      _match_threshold: SEMANTIC_MATCH_THRESHOLD,
      _agency_id: agency_id,
      _surfaces: ['public'],
    });

    if (error) throw error;

    const top = (data ?? [])[0] as { content: string; document_title: string; similarity: number } | undefined;

    return new Response(
      JSON.stringify({
        grounded: !!top,
        content: top?.content ?? null,
        document_title: top?.document_title ?? null,
        top_similarity: top?.similarity ?? null,
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
