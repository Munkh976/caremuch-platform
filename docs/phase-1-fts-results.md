# Phase 1 Knowledge Base — FTS Retrieval Probe Results

**Status:** Path A (Postgres full-text search knowledge base, bilingual, zero AI
provider) validated on real content, 2026-09-02. Not the full eval — this is an
11-query probe against 8 seeded documents, but it proves the architecture works
end-to-end before any further investment (upload UI, full eval harness, embeddings).

## What was tested

- Schema: `knowledge_documents`/`knowledge_chunks` with agency + language isolation
  (`supabase/migrations/20260902120000_knowledge_base_bilingual.sql`).
- Retrieval: `search_agency_knowledge()`, `SECURITY DEFINER`, scoped via `my_agency_id()`
  (which wraps `current_agency_id()` rather than duplicating it). Originally used
  `plainto_tsquery` (ANDs all terms); fixed to build an OR'd tsquery from the question's
  own stemmed lexemes after the probe showed AND-strictness failing on natural questions
  (`supabase/migrations/20260902140000_fix_search_agency_knowledge_or_matching.sql`).
- Content: 4 PHI-free agency-knowledge documents (attendance/call-off policy, PTO
  policy, dementia care SOP, medication reminder guidelines), English + Spanish each,
  deterministically paragraph-chunked into 32 chunks
  (`supabase/migrations/20260902130000_seed_knowledge_base_probe.sql`).
- 11 test queries run against the live function, session-simulated as a real
  authenticated agency-admin user (`munkh.mn@gmail.com`, agency `56fbfe38`).

## Results

**Retrieval works, in both languages.** Genuinely answerable questions correctly
surface the right chunk at the top of the ranking, even when the question's wording
doesn't exactly match the document's (the original bug this session fixed — e.g. "earn"
vs. the document's "accrue"):
- Q1 (en, "How many hours of PTO do I earn?") → correct PTO chunk, `rank = 0.040`
- Q5 (es, "¿Cuántas horas de PTO puedo acumular?") → correct Spanish PTO chunk, `rank = 0.047`

**Refusal works — unanswerable questions produce only noise-level scores, not genuine
hits.** Under the OR-based fix, the hard "zero rows" gate is intentionally weaker (it
only excludes questions sharing *zero* vocabulary with anything in scope), so the rank
threshold is what actually distinguishes a real answer from incidental overlap:
- Q8 (en, "What is the agency's overtime pay rate?" — an unanswerable question that
  happens to share the word "pay" with "Paid Time Off") → `rank = 0.015`, not a genuine hit
- Q10 (es, "¿Cómo actualizo mi información bancaria para el depósito directo?") →
  `rank = 0.010`, likewise noise-level

**Language isolation holds empirically, not just structurally.** Q11 (query text
literally `"PTO"`, `_language = 'en'`) returned only the English PTO chunk — even
though the literal substring "PTO" also appears verbatim inside the Spanish document's
content (`"tiempo libre pagado (PTO)"`). This confirms the `language = _language` filter
is doing real, load-bearing enforcement, not just coasting on English/Spanish having
different vocabularies most of the time.

## Recommended τ (provisional — from this probe, not a final tuned value)

**τ ≈ 0.025–0.03** cleanly separates the genuine-hit band (~0.04+, both languages) from
the noise band (~0.010–0.015, both languages) observed in this probe. This is a
starting hypothesis from 11 queries against 8 documents — it must be re-validated
against the full 30–50 question eval (answerable / ambiguous / unanswerable, both
languages, per the original eval plan) before being treated as a production value. It
is directionally strong evidence that a workable threshold exists on the FTS baseline
at all, which was the open question this probe was designed to answer.

## Conclusion

The Phase 1 architecture — schema, agency isolation (`my_agency_id()`), staff-only RLS,
bilingual (`en`/`es`) generated `search_vector`, `SECURITY DEFINER` retrieval, and a
two-stage confidence gate (hard lexical-overlap gate + soft rank threshold) — is
validated end-to-end against real bilingual content, using **zero external AI
providers, zero embeddings, zero LLM calls**. Postgres full-text search + `ts_rank` is
the deliberately cheap, deterministic stand-in for the retrieval *mechanism* specifically;
everything else in the design — the document/chunk model, the isolation guarantees, the
gate concept, and the manager document-upload path — is intended to carry unchanged
into Phase 2 (per the original forward-compatibility plan), with only the ranking
internals of `search_agency_knowledge()` swapping to vector similarity once an embedding
provider is chosen.

## Known limitation — the quantified Phase 2 (embeddings) lift target

Even with OR matching, pure keyword/stem matching cannot bridge a genuine
zero-vocabulary-overlap paraphrase: a question phrased with entirely different words
than a document ever uses, sharing no stem at all, will return zero rows regardless of
how semantically close the underlying meaning is — FTS has no notion of meaning beyond
shared lexemes. This is the FTS baseline's one fundamental, architecturally-unfixable
limitation, not a bug to chase further within this design. It's the specific,
quantifiable gap embeddings are meant to close in Phase 2 — the formal eval (§ above)
should measure how often this actually occurs in practice, giving a real number for how
much lift embeddings need to deliver to be worth the added provider/PHI complexity.
