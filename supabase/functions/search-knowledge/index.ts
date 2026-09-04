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

    // No caller identity to resolve -- genuinely anonymous visitors have no session at
    // all, and match_agency_knowledge is already agency-scoped via the explicit
    // _agency_id parameter (mirrors search_agency_knowledge's anon design,
    // 20260903140000) -- a plain anon client is correct and sufficient here.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { data, error } = await supabase.rpc('match_agency_knowledge', {
      _query_embedding: queryEmbedding,
      _language: language,
      _match_threshold: SEMANTIC_MATCH_THRESHOLD,
      _agency_id: agency_id,
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
