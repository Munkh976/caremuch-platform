# Phase 2 Embedding Provider — Confirmed

**Status:** Confirmed via live smoke test, 2026-09-03. This is the source of truth for the
`vector(N)` migration — the dimension below is endpoint-confirmed, not assumed (per
CLAUDE.md's "Embedding model/dimension" rule: never guess the vector dimension).

## Decision

- **Provider (Phase 2 build):** OpenAI-direct.
- **Model:** `text-embedding-3-small`.
- **Why OpenAI-direct now:** real agency document uploads are ~2 months out, so this proves
  the vector architecture end-to-end on PHI-free agency knowledge before that timeline
  matters. OpenAI → Azure later is a configuration swap, not a re-embed, because Azure's
  `text-embedding-3-small` deployment produces the same 1536-dim vectors from the same
  model — see "Azure migration path" below.
- **`phiAllowed`:** `false`, hard-enforced. OpenAI-direct is NOT BAA-covered. This is
  correct, not a limitation — knowledge embeddings are PHI-free by construction (see
  CLAUDE.md's "Phase 1 RAG = PHI-FREE" and the readiness assessment's Step 3 structural
  confirmation: no `client_id` FK or column anywhere in `knowledge_documents`/
  `knowledge_chunks`).

## Smoke test result

Ran via a throwaway Edge Function (`supabase/functions/smoke-embed`, deployed and invoked
2026-09-03, deleted after recording this result — see git history for its final content if
ever needed) that read `OPENAI_API_KEY`/`EMBEDDING_MODEL` from Supabase Edge Function
secrets and POSTed one real sentence to `https://api.openai.com/v1/embeddings`, asserting
only `dimension > 0` (never a hardcoded expected value):

| Field | Value |
|---|---|
| `model` (as returned by OpenAI) | `text-embedding-3-small` |
| **`dimension`** | **1536** |
| `usage.prompt_tokens` / `usage.total_tokens` | 15 / 15 |
| Sample vector | Confirmed real floating-point values (not recorded here) |

## What this unblocks

The next tranche's `vector(1536)` migration on `knowledge_chunks` uses this confirmed
number directly. No further smoke test is needed unless the model or provider changes.

## Azure migration path (for when the PHI/BAA gate is crossed)

Azure OpenAI Service's `text-embedding-3-small` deployment is the same underlying model as
OpenAI-direct's, producing identical 1536-dimension vectors — so switching
`EMBEDDING_PROVIDER` from `openai` to `azure` behind the `EmbeddingProvider` interface
(once built) is expected to be a configuration change, not a schema change or a
re-embedding migration, *as long as the same model is used on both sides*. This is not
re-verified against a live Azure endpoint yet — treat it as the working assumption until an
actual Azure smoke test confirms it, per the same "never guess the dimension" rule this
document exists to satisfy in the first place.
