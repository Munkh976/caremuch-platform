// Internal diagnostic: proves the EmbeddingProvider seam (interface + factory + PHI
// guard) works end-to-end against whatever provider EMBEDDING_PROVIDER currently
// selects -- not a raw fetch like the earlier smoke-embed function, the real seam.
// KEPT in the repo (not a throwaway like smoke-embed): useful to re-run any time
// EMBEDDING_PROVIDER/secrets change, most notably when Azure is added later. It has no
// auth guard of its own and hits a billed endpoint, so it is only ever deployed for the
// duration of a manual check and undeployed immediately after -- it should not normally
// sit deployed. No DB access, no writes, no PHI (requiresPhi: false is correct here:
// this is a fixed diagnostic sentence, not real agency content).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getEmbeddingProvider } from "../_shared/getEmbeddingProvider.ts";
import { assertPhiSafe } from "../_shared/embeddingProvider.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const provider = getEmbeddingProvider();

    // The load-bearing call site: every real embedding call must pass through this
    // guard first. requiresPhi: false because this is a fixed diagnostic sentence, not
    // real agency/client content.
    assertPhiSafe(provider, {
      requiresPhi: false,
      description: "embedding-provider-check proof invocation",
    });

    const result = await provider.embed(
      "Caregivers must follow the agency's dementia care SOP when assisting clients."
    );

    return new Response(
      JSON.stringify({
        reported_model: result.model,
        reported_dimension: result.dimension,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in embedding-provider-check:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
