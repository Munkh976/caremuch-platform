import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getEmbeddingProvider } from "../_shared/getEmbeddingProvider.ts";
import { assertPhiSafe } from "../_shared/embeddingProvider.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Small on purpose, not limit-tuned -- see chat/commit for reasoning: bounds the
// at-risk window per request to at most this many un-embedded chunks.
const BATCH_SIZE = 50;

// Matches knowledge_chunks.embedding vector(1536) -- confirmed dimension, see
// docs/phase-2-embedding-provider.md and migration 20260903160000. A mismatch here
// means the configured model changed and this backfill's whole premise is void, not
// just one row -- treated as fatal for the run, not skip-and-continue.
const COLUMN_DIMENSION = 1536;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Caller's own JWT, NOT service_role -- every read/write below runs as the caller,
    // so the existing staff-only, agency-scoped RLS policy on knowledge_chunks
    // (20260902120000) is the real tenancy boundary, not a manual filter here. This
    // also means every count below is scoped to the caller's own agency, not global --
    // see docs/known-issues.md's "DEFERRED: knowledge base embedding backfill has no
    // global cross-agency path" for why, and what a global path would require.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );

    const { data: { user: caller }, error: authError } = await supabase.auth.getUser();
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Not the real security boundary (RLS is) -- this just turns "wrong role" into a
    // clear 403 instead of a silent "0 candidates".
    const { data: callerRole } = await supabase.rpc('get_user_role', { _user_id: caller.id });
    const allowedRoles = ['system_admin', 'agency_admin', 'manager'];
    if (!callerRole || !allowedRoles.includes(callerRole)) {
      return new Response(
        JSON.stringify({ error: 'You do not have permission to run the knowledge base backfill' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provider = getEmbeddingProvider();
    // Load-bearing call site, same as embedding-provider-check: requiresPhi: false is
    // correct here -- agency-knowledge chunks are PHI-free by construction (no
    // client_id path on knowledge_documents/knowledge_chunks).
    assertPhiSafe(provider, { requiresPhi: false, description: 'knowledge_chunks backfill' });

    // NOTE: every count in this response is scoped by RLS to the caller's own agency,
    // not a global total across all agencies -- see the field names and "scope" below.
    const { count: agencyTotalChunks } = await supabase
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true });

    const { count: agencyNullCandidatesAtStart } = await supabase
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .is('embedding', null);

    let embeddedThisRun = 0;
    let batchCount = 0;
    const errors: { chunk_id: string; message: string }[] = [];
    let fatal = false;

    while (!fatal) {
      // Idempotent/resumable: only ever selects rows still missing an embedding. A
      // completed run selects zero rows here and does nothing further; a mid-run
      // failure can simply be re-run and picks up exactly where it left off, since
      // already-embedded rows no longer match this WHERE clause. No chunk is ever
      // double-embedded.
      const { data: batch, error: selectError } = await supabase
        .from('knowledge_chunks')
        .select('id, content')
        .is('embedding', null)
        .order('id', { ascending: true })
        .limit(BATCH_SIZE);

      if (selectError) throw selectError;
      if (!batch || batch.length === 0) break;

      batchCount++;

      let result;
      try {
        result = await provider.embed(batch.map((c: { content: string }) => c.content));
      } catch (embedError) {
        errors.push({
          chunk_id: `batch#${batchCount}`,
          message: embedError instanceof Error ? embedError.message : String(embedError),
        });
        break; // stop the run; already-written batches persist, rerun will resume
      }

      // Preserve input<->output order: OpenAI returns embeddings in the same order as
      // the input array, so batch[i] <-> result.embeddings[i] by position.
      for (let i = 0; i < batch.length; i++) {
        const chunk = batch[i];
        const vector = result.embeddings[i];

        if (vector.length !== COLUMN_DIMENSION) {
          // Fatal for the whole run, not just this row -- a dimension mismatch means
          // the model changed, which affects every remaining chunk identically.
          errors.push({
            chunk_id: chunk.id,
            message: `Dimension mismatch: got ${vector.length}, column is vector(${COLUMN_DIMENSION}). Refusing to write -- model may have changed.`,
          });
          fatal = true;
          break;
        }

        const { error: updateError } = await supabase
          .from('knowledge_chunks')
          .update({ embedding: vector })
          .eq('id', chunk.id)
          .is('embedding', null); // extra guard: never overwrite a row a concurrent run already filled
        if (updateError) {
          errors.push({ chunk_id: chunk.id, message: updateError.message });
        } else {
          embeddedThisRun++;
        }
      }
    }

    const { count: agencyRemainingNull } = await supabase
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .is('embedding', null);

    return new Response(
      JSON.stringify({
        scope: "Counts below are scoped to your own agency via RLS, not a global total across all agencies.",
        agency_total_chunks: agencyTotalChunks,
        agency_null_candidates_at_start: agencyNullCandidatesAtStart ?? 0,
        embedded_this_run: embeddedThisRun,
        batch_count: batchCount,
        agency_remaining_null: agencyRemainingNull,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in backfill-knowledge-embeddings:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
