# Tranche 3E — Real Public Corpus (Staged): Complete Plan

> **Status: APPROVED. Staging change IMPLEMENTED and VERIFIED** (§4a) against the live
> deployed `ingest-knowledge-document`/`search-knowledge` functions, 2026-09-06 — not
> merely reasoned about. Real content authoring/ingestion and activation (§5/§6) remain
> pending — activation is explicitly gated on Tranche 3G, not on this document. This
> plan supersedes the flat 3E→3F→3G ordering in
> `docs/CareMuch_Phase_3_and_4_Development_Plan.md` — see §7, Finding 1.

## 1. Executive Summary

3E creates the first real public-surface knowledge content, for the existing agency
(`56fbfe38`), staged so it is never anonymously reachable before Tranche 3G's
retrieval-mode re-measurement runs against it. `search-knowledge`/`KnowledgeQaSurface`/
`PublicOffice` (`/a/:slug`) have been live since Phase 1 — ingesting a `surface='public',
is_active=true` document *is* exposing real anonymous traffic to real content, with no
separate "3F build" step left to gate that exposure. The gate is staging (`is_active`),
not a future serving-path build.

## 2. Step 0 — Pre-flight Check: RUN, CLEAN (2026-09-06)

Query (read-only, run directly in Supabase Studio):

```sql
SELECT id, title, ingestion_status, is_active, created_at
FROM knowledge_documents WHERE surface = 'public';
```

**Result: zero rows.** No public-surface content existed in any state at the time this
tranche began — no live exposure, no staged leftover, no escaped 3B/3C test artifact.
The public-surface instant-live hazard (§7, Finding 2) was structurally possible during
3B/3C but never actually triggered. 3E starts from a genuinely clean state. This is
recorded as closed, not carried forward as an open pre-execution check.

## 3. Staging Mechanism — Staged-from-Creation (IMPLEMENTED)

One scoped, additive change to `ingest-knowledge-document/index.ts`, at the document
INSERT: `is_active: surface === 'public' ? false : true`. No schema change --
`is_active` already existed and already defaulted `true`; this changes only which value
`surface='public'` rows get at insert time. Public-surface documents now land
**inactive from creation**, never via a follow-up UPDATE, so there is no live window to
close after the fact. Caregiver-surface ingestion is unchanged from 3B/3C.

## 4. Confirming `is_active` Is the Sole Liveness Gate (verified, not assumed)

Staging introduces a state that never existed before: `ingestion_status='ready'` AND
`is_active=false` ("ready but inactive"). Before relying on `is_active` alone, the
serving path was grepped end-to-end for any other code treating `ingestion_status=
'ready'` as an independent liveness signal:

- Every write to `ingestion_status` happens inside `ingest-knowledge-document`'s own
  state machine (`pending→extracting→chunking→embedding→ready`/`failed`).
- The only read of it outside that function is `AgencySettings.tsx`'s post-ingest
  success/error toast, driven by the synchronous response payload of the staff
  member's own ingestion call -- not a database query, not a serving-path check.
- `match_agency_knowledge`/`search_agency_knowledge` filter on `agency_id`, `is_active`,
  `surface = ANY(_surfaces)`, `language`, `embedding IS NOT NULL` -- `ingestion_status`
  appears in neither function.
- `KnowledgeQaSurface.tsx`, `PublicOffice.tsx`, `search-knowledge/index.ts`, and
  `rag-eval-harness/index.ts` contain zero references to `ingestion_status`.

**Confirmed: no code path anywhere uses `ingestion_status='ready'` as a serving
signal independent of `is_active`.** A "ready but inactive" document is invisible to
every serving path for the same reason every other inactive document already is.

### 4a. Live Verification (2026-09-06) -- the static grep above, proven at runtime

A static grep proves no code *currently* checks `ingestion_status` as a liveness
signal; it does not prove the deployed staging conditional actually behaves as
written, or that a staged row is genuinely unreachable end-to-end through the real
running functions. Per this project's own precedent (Tranche 3C's disposable-account
attestation-bypass test): a real, throwaway staff account was created via the
service-role admin API for agency `56fbfe38`, signed in through the real
`signInWithPassword` auth path (a genuine JWT, not a forged/impersonated session), and
used to exercise the actually-deployed `ingest-knowledge-document` and
`search-knowledge` functions exactly as a real staff member and a real anonymous
visitor would. Run via a throwaway Edge Function, invoked once, results captured, then
undeployed and deleted (confirmed via `git status` that no trace remains -- same
discipline as the Tranche 3D provider-check).

**Results:**
1. Ingested a synthetic PUBLIC test document (marker phrase `zephyr-quokka-9142`) --
   `ingestion_status: 'ready'`, `chunk_count: 1`.
2. Ingested a synthetic CAREGIVER test document -- `ingestion_status: 'ready'`,
   `chunk_count: 1`.
3. Direct `knowledge_documents` read (service-role): PUBLIC doc `is_active: false`;
   CAREGIVER doc `is_active: true`, unchanged -- the staging conditional behaves
   exactly as written for both surfaces.
4. Direct `knowledge_chunks` read for the staged PUBLIC doc: chunk present, embedding
   present (`has_embedding: true`), content matches -- staged content is fully
   verifiable via direct read, confirming §5 below.
5. Anonymous `search-knowledge` query for the exact marker phrase: `grounded: false`
   -- the staged document, though real, embedded, and readable directly, is
   unreachable through the actual serving path.
6. Teardown: chunks, documents, storage objects, and the throwaway account all
   deleted, each step's own result checked (not assumed) -- no error on any step.

**This is the whole-tranche proof, run against the live system, not reasoned about:**
staged content is simultaneously verifiable and unreachable, end-to-end.

### 4b. Teardown Confirmed by Content, Not by Delete-Returned-Ok (2026-09-06)

Per the same 3B/3C standard (prove absence by content), a second throwaway,
one-shot verification function checked actual state after §4a's teardown, rather than
trusting each delete call's `ok:true`:

- Marker-phrase grep across `knowledge_chunks`, all agencies: **0 rows**.
- Throwaway account lookup via `auth.admin.getUserById`: **not found** ("User not
  found"), confirmed gone from `auth.users` directly, not inferred from the delete
  call's return.
- `user_roles` rows for that user id: **0 rows** -- cascade confirmed by content.
- `knowledge-uploads` storage listing under the test's prefix
  (`56fbfe38-.../3e-test`): **0 objects**.

Verification function itself undeployed and deleted immediately after, confirmed via
`git status` that no trace remains -- same discipline applied to both throwaway
functions used in this tranche.

## 5. Ingestion Verification — Direct Read, Not the Filtered RPCs

`is_active` is business logic embedded inside `match_agency_knowledge`/
`search_agency_knowledge` -- it is not an RLS policy on `knowledge_documents`/
`knowledge_chunks`. Staged rows are invisible to those two RPCs (and therefore to
`rag-eval-harness`) but fully visible to any ordinary table read. 3E verifies each
ingested document's correctness via:

- the `ingest-knowledge-document` response payload itself (`document_id`,
  `ingestion_status`, `chunk_count`) -- already surfaced in `AgencySettings.tsx`;
- a direct, staff-authenticated or service-role `SELECT` on
  `knowledge_chunks WHERE document_id = ...`, confirming `embedding IS NOT NULL`,
  contiguous `chunk_index`, and expected chunk count.

Neither path routes through the `is_active`-filtered RPCs. **The eval harness's
`is_active`-bypass / `_surfaces:['public']` parameterization remains entirely Tranche
3G's problem -- 3E has no read-dependency on it.**

## 6. Sequence and Activation Contract

```text
3E: author + ingest real public content, STAGED (is_active=false from creation)
        │  verify via ingest response + direct knowledge_chunks read (§5)
        ▼
3G: rag-eval-harness measures FTS vs VECTOR against THIS staged corpus
    (requires the harness's own is_active-bypass + _surfaces:['public'] work -- 3G scope)
        │
        ▼
   retrieval_mode set on evidence (KNOWLEDGE_RETRIEVAL_MODE env var)
        │
        ▼
   ACTIVATE -- see contract below
        │
        ▼
"3F becomes real" -- this activation IS 3F; no new serving-path code is built, because
KnowledgeQaSurface/search-knowledge/PublicOffice have existed since Phase 1.
```

**Activation contract** (the safe procedure, written down before anyone stands at that
moment post-3G -- activation is the single most dangerous operation in this flow: the
moment content goes public to anonymous visitors, via a bare UPDATE):

1. **Happens only after Tranche 3G has recorded a `retrieval_mode` decision for this
   specific corpus.** No activation before that record exists.
2. **Flips only documents that reached `ingestion_status='ready'` AND were verified per
   §5** (ingest-response success plus a direct `knowledge_chunks` read confirming
   embeddings present, correct chunk sequence, expected count). A document that never
   reached `'ready'`, or was never individually verified, is not a candidate for
   activation regardless of its `surface` value.
3. **Scoped to specific document IDs, never a blanket `UPDATE ... WHERE
   surface='public'`.** The activation statement must enumerate exactly the document
   IDs cleared by steps 1-2 (e.g. `UPDATE knowledge_documents SET is_active = true
   WHERE id IN (...)`), so a guard-blocked, half-ingested, or unverified document can
   never be swept live by a broad update. Each activation is an explicit, auditable act
   with a recorded document-ID list, not a default or a convenience query.

## 7. Findings Surfaced This Pass (recorded, not new work)

**Finding 1 -- 3E and 3F are the same event under the current architecture.**
`search-knowledge`, `KnowledgeQaSurface.tsx`, and `PublicOffice.tsx` were built and
deployed in Phase 1, before 3A's surface separation existed. There is no remaining "3F
build" -- the tranche's only real content is the activation flip in §6, gated on 3G.
The Development Plan's roadmap table still lists 3F as if it were a separate build
step; it is not, under the architecture as it stands today.

**Finding 2 -- the public-surface instant-live hazard was real, though never
triggered (§2).** Before §3's change, `AgencySettings.tsx`'s test-harness ingestion UI
offered `surface: 'public'` as a dropdown option, and `is_active`'s schema default of
`true` meant choosing it produced an immediately live, anonymously-servable document --
structurally possible the entire time 3B/3C existed. Closed by staged-from-creation
(§3). Recommended `known-issues.md` entry (not written in this pass -- a follow-up
docs-hygiene item, alongside marking the now-stale "PRE-PRODUCTION GATE: no
knowledge-authorization scope" entry resolved-by-3A):

> Public-surface ingestion was instantly live to anonymous traffic (no staging state)
> from 3B through 3C. Closed in 3E via staged-from-creation (`is_active=false` at
> INSERT for `surface='public'`). Any future real (non-test-harness) upload path must
> preserve this staging behavior -- do not insert `knowledge_documents` rows for public
> content any other way without it.

## 8. Acceptance Criteria

- Real public content authored and ingested via the unmodified 3B/3C pipeline (guard +
  attestation apply identically, no changes to either).
- Every `surface='public'` document lands `is_active=false` at creation -- no live
  window, ever (§3, §4).
- Each ingested document verified via ingest-response payload + direct
  `knowledge_chunks` read (§5) -- never via the filtered RPCs.
- Step 0 pre-flight stands as already satisfied (§2).
- Activation, when it happens, follows the contract in §6 exactly.
- No schema change, no `phiAllowed`/provider change, no RPC/grant change.

## 9. Risks

The §3 INSERT conditional is low-risk: additive, conditional only on `surface`, doesn't
touch the caregiver path, doesn't touch any RPC or grant. The structural risk this
design eliminates (Finding 2) is closed going forward for `ingest-knowledge-document`;
it remains a documented hazard for any future, different upload path until the
recommended known-issues entry is written and read.

## 10. Explicitly Out of Scope

3G's harness/RPC parameterization (§5). Gate 3/LLM answerability. Caregiver-surface
content. Activation itself (§6 -- a distinct, later, evidence-gated act performed only
after 3G). Any UI beyond the existing test-harness form. `batch-create-users`/
`AddUser.tsx` (confirmed independent security tranches, not 3E blockers, under the
confirmed premise that 3E targets the existing demo agency, not new-customer
onboarding). The stale known-issues PRE-PRODUCTION GATE entry (confirmed fully
resolved by 3A -- a docs-hygiene note, not 3E work).

## 11. Preserved, Not Reopened

3A's surface boundary, RPC signatures, and anon/authenticated grant revocation.
3C's guard, attestation, and Conditional-A decision -- still expiring at 3G, still not
BAA-gated. 3D's provider posture (OpenAI-direct, `phiAllowed=false`) -- unchanged;
public content remains PHI-free by design and the guard already covers it.
