// Phase 3 Tranche 3B (mechanism only): synchronous, single-document ingestion
// pipeline. Validate -> extract -> normalize -> [3C GUARD INSERTS HERE, not built] ->
// chunk -> embed -> store. SYNTHETIC TEST CONTENT ONLY in this tranche -- real agency
// document ingestion (Phase 1G) stays blocked until 3C (PHI/PII guard) and 3D
// (provider/BAA decision) both exist, per CLAUDE.md's hard gate. Nothing in this file
// assumes content is already PHI-safe; it hardcodes requiresPhi: false because every
// caller in this tranche is a human-authored synthetic test file, exactly like every
// other existing requiresPhi: false call site in this codebase.
//
// Auth: caller's own JWT, NOT service_role -- staff already have direct INSERT/UPDATE
// rights on knowledge_documents/knowledge_chunks via existing RLS
// (is_agency_staff() AND agency_id = current_agency_id()), so this function needs no
// elevated privilege for its DB writes, matching backfill-knowledge-embeddings'
// least-privilege precedent, not search-knowledge's (which needs service_role because
// its anonymous callers have no session at all).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { extractText, getDocumentProxy } from "npm:unpdf@0.11.0";
import mammoth from "npm:mammoth@1.7.2";
import { getEmbeddingProvider } from "../_shared/getEmbeddingProvider.ts";
import { assertPhiSafe } from "../_shared/embeddingProvider.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_ROLES = ['system_admin', 'agency_admin', 'manager'];
const MIN_EXTRACTED_CHARS = 20; // conservative: reject only clearly-empty extractions
const CHUNK_TARGET_CHARS = 2000; // ~500 tokens at ~4 chars/token (approximation, not exact tokenization)
const CHUNK_OVERLAP_CHARS = 300; // ~15%

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Hybrid paragraph-first chunking with fixed-window fallback for oversized paragraphs,
 *  overlapping. Paragraph splits preserve natural structure when present; the
 *  fixed-window fallback keeps any single oversized block from becoming one giant,
 *  unembeddable chunk. Token counting is a character-count approximation, not exact --
 *  acceptable for proving the mechanism, revisit with real tokenization once real
 *  content quality matters (3E+). */
function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= CHUNK_TARGET_CHARS) {
      chunks.push(para);
      continue;
    }
    let start = 0;
    while (start < para.length) {
      const end = Math.min(start + CHUNK_TARGET_CHARS, para.length);
      chunks.push(para.slice(start, end));
      if (end >= para.length) break;
      start = end - CHUNK_OVERLAP_CHARS;
    }
  }

  return chunks;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let supabase;
  let documentId: string | null = null;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: callerRole } = await supabase.rpc('get_user_role', { _user_id: caller.id });
    if (!callerRole || !ALLOWED_ROLES.includes(callerRole)) {
      return new Response(JSON.stringify({ error: 'You do not have permission to ingest knowledge documents' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: callerProfile } = await supabase.from('profiles').select('agency_id').eq('id', caller.id).single();
    if (!callerProfile?.agency_id) {
      return new Response(JSON.stringify({ error: 'Caller profile missing agency_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const agencyId = callerProfile.agency_id;

    const { storage_path, filename, surface, language, title, replace_document_id } = await req.json();

    if (!storage_path || typeof storage_path !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing storage_path' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (surface !== 'public' && surface !== 'caregiver') {
      // No default here either -- matches 3A's RPC precedent: the caller (the upload
      // UI) must pass this explicitly. The UI's OWN default selection is 'caregiver',
      // but this function does not infer or default it on the caller's behalf.
      return new Response(JSON.stringify({ error: 'surface must be explicitly "public" or "caregiver"' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (language !== 'en' && language !== 'es') {
      return new Response(JSON.stringify({ error: 'language must be "en" or "es"' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!title || typeof title !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing title' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const ext = (filename ?? '').split('.').pop()?.toLowerCase();
    const fileFormat = ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : ext === 'txt' ? 'txt' : null;
    if (!fileFormat) {
      return new Response(JSON.stringify({ error: 'Unsupported file format -- must be .pdf, .docx, or .txt' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Create the row immediately, status 'pending' -- a diagnosable row exists from
    // the very first step, matching the "fail loud, never silently stuck" precedent.
    const { data: newDoc, error: insertError } = await supabase
      .from('knowledge_documents')
      .insert({
        agency_id: agencyId,
        language,
        title,
        category: 'ingested',
        content: '',
        surface,
        source_storage_path: storage_path,
        file_format: fileFormat,
        ingestion_status: 'pending',
        is_demo: true, // mechanism-only phase: every document created here is a test fixture
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    documentId = newDoc.id;

    // ---- extracting ----
    await supabase.from('knowledge_documents').update({ ingestion_status: 'extracting' }).eq('id', documentId);

    const { data: fileBlob, error: downloadError } = await supabase.storage.from('knowledge-uploads').download(storage_path);
    if (downloadError) throw new Error(`Storage download failed: ${downloadError.message}`);
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());

    let rawText = '';
    if (fileFormat === 'txt') {
      rawText = new TextDecoder('utf-8').decode(bytes);
    } else if (fileFormat === 'pdf') {
      const pdf = await getDocumentProxy(bytes);
      const result = await extractText(pdf, { mergePages: true });
      rawText = Array.isArray(result.text) ? result.text.join('\n') : result.text;
    } else if (fileFormat === 'docx') {
      const result = await mammoth.extractRawText({ buffer: bytes });
      rawText = result.value;
    }

    const normalized = normalize(rawText);

    if (normalized.length < MIN_EXTRACTED_CHARS) {
      const msg = `Extraction produced ${normalized.length} chars, below threshold (${MIN_EXTRACTED_CHARS}) -- possible scanned/image PDF or empty document`;
      await supabase.from('knowledge_documents').update({ ingestion_status: 'failed', ingestion_error: msg }).eq('id', documentId);
      return new Response(JSON.stringify({ document_id: documentId, ingestion_status: 'failed', ingestion_error: msg }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ---- [3C PHI/PII GUARD INSERTS HERE] ----
    // Not built. When it exists: inspect `normalized` here, and feed its finding into
    // the requiresPhi value passed to assertPhiSafe() below (detected/uncertain PHI ->
    // true; clean -> false) instead of the hardcoded false this tranche uses. No other
    // change to this pipeline is needed for 3C to slot in.

    // ---- chunking ----
    await supabase.from('knowledge_documents').update({ ingestion_status: 'chunking' }).eq('id', documentId);
    const chunks = chunkText(normalized);
    if (chunks.length === 0) {
      throw new Error('Chunking produced zero chunks from non-empty extracted text -- this should not happen');
    }

    // ---- embedding ----
    await supabase.from('knowledge_documents').update({ ingestion_status: 'embedding' }).eq('id', documentId);
    const provider = getEmbeddingProvider();
    // requiresPhi: false -- mechanism-only phase, every file here is a synthetic test
    // fixture authored by a developer, not real agency content. See the 3C insertion
    // point comment above for what changes once the guard exists.
    assertPhiSafe(provider, { requiresPhi: false, description: 'knowledge document ingestion (synthetic test content, Tranche 3B)' });
    const { embeddings } = await provider.embed(chunks);

    if (embeddings.length !== chunks.length) {
      throw new Error(`Embedding count mismatch: ${chunks.length} chunks, ${embeddings.length} embeddings`);
    }

    // ---- store ----
    const { error: updateContentError } = await supabase
      .from('knowledge_documents')
      .update({ content: normalized })
      .eq('id', documentId);
    if (updateContentError) throw updateContentError;

    const chunkRows = chunks.map((content, i) => ({
      document_id: documentId,
      language,
      chunk_index: i,
      content,
      embedding: `[${embeddings[i].join(',')}]`,
      is_demo: true,
    }));
    const { error: chunkInsertError } = await supabase.from('knowledge_chunks').insert(chunkRows);
    if (chunkInsertError) throw chunkInsertError;

    await supabase.from('knowledge_documents').update({ ingestion_status: 'ready' }).eq('id', documentId);

    // ---- versioning: supersede the old document, if replacing ----
    // Setting is_active = false is sufficient to make the old document's chunks
    // non-retrievable too, with no separate chunk-level action -- both retrieval RPCs
    // (search_agency_knowledge, match_agency_knowledge) already join through
    // knowledge_documents and filter on d.is_active; an inactive document's chunks are
    // excluded by that existing filter, not a new mechanism.
    if (replace_document_id && typeof replace_document_id === 'string') {
      const { error: supersedeError } = await supabase
        .from('knowledge_documents')
        .update({ is_active: false, superseded_by: documentId })
        .eq('id', replace_document_id)
        .eq('agency_id', agencyId); // defense in depth; RLS already enforces this too
      if (supersedeError) throw supersedeError;
    }

    return new Response(
      JSON.stringify({ document_id: documentId, ingestion_status: 'ready', chunk_count: chunks.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error in ingest-knowledge-document:', error);
    if (supabase && documentId) {
      // Fail loud, never silently stuck -- always leave a diagnosable row.
      await supabase.from('knowledge_documents').update({ ingestion_status: 'failed', ingestion_error: message }).eq('id', documentId);
    }
    return new Response(
      JSON.stringify({ document_id: documentId, error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
