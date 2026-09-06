# Phase 3 Tranche 3D — Provider/BAA Production Gate: Decision Record

**Decision:** OpenAI-direct remains the embedding provider through Phase 3 (PUBLIC
corpus). `phiAllowed` stays hard-enforced `false`. No real agency content flows until
Tranche 3C's PHI/PII guard exists — the guard is the sole barrier on this path, not
the provider. No PHI-capable path is provisioned now; the decision on which one is
**deferred**, not rejected, until a real PHI flow is actually slated.

## Verified empirically, 2026-09-05

Deployed config resolves to `provider_name="openai"`, `phi_allowed=false` — read via a
temporary, read-only diagnostic (deployed, checked once, immediately undeployed and
deleted; confirmed via `git status` that no trace remains). `assertPhiSafe()` is
called (not just defined) at both live embedding call sites (`search-knowledge`,
`ingest-knowledge-document`), both correctly passing `requiresPhi: false` for their
PHI-free/synthetic content. Given `phi_allowed=false` is confirmed, any call passing
`requiresPhi: true` today would throw immediately, before any request reaches
OpenAI — a direct logical consequence of the confirmed value and the guard's own
source, not a remaining assumption. **The guard has never been exercised with a
`true` declaration in this codebase's history — enforcement is real, untested in
practice until 3C.**

## The deferred PHI path is not just Azure

**Verified against published provider terms on 2026-09-05** (postdating this
project's earlier planning docs and prior guidance) — **account-specific BAA scope
and pricing must still be confirmed directly with OpenAI sales when the PHI path
actually opens; this record does not close that.**

The deferred PHI path is **either**:

**(a) An OpenAI BAA** (`baa@openai.com`, reported 1–2 day turnaround) with **Zero Data
Retention (ZDR) enabled per call** — the embeddings endpoint is ZDR-eligible. This
option keeps the *same* OpenAI model (`text-embedding-3-small`, 1536-dim) already in
use, and therefore **avoids the re-embedding migration and any `vector(N)` schema
change entirely** — it is a config/contract change, not a provider change.

**or**

**(b) Azure OpenAI** (BAA-covered by default on a Microsoft Enterprise Agreement) — a
genuine provider *change*, carrying the full switch cost below.

**(a) is likely the cheaper path and should be evaluated first**, specifically
*because* it avoids the re-embedding tail entirely — this is a materially different
cost profile than this project's earlier "Azure is the only PHI-capable path"
framing assumed, and that earlier framing should not be treated as settled. **Neither
path is provisioned now. The choice between them is deferred until a real PHI flow is
slated**, not decided in this record.

## Switch-cost statement — applies to the Azure path only

Re-embedding whatever corpus exists at switch time, plus a possible `vector(N)`
migration if Azure's model deployment doesn't produce identical 1536-dim vectors
(unverified against a live Azure endpoint — per `docs/phase-2-embedding-provider.md`,
this is a working assumption, not yet confirmed; never guess the dimension), is the
cost of switching to **Azure OpenAI specifically (path b)**. **The OpenAI-BAA path
(path a) carries no re-embedding cost at all** — same model, same vectors, same
schema; only the contractual/config layer changes. Do not read the switch-cost
analysis as applying to every PHI-capable option — one path carries a re-embedding
tail, the other does not.

For Phase 3 (PUBLIC corpus only, modest size by design), neither path is being
provisioned yet, so this cost is not currently being incurred either way. If path (b)
is eventually chosen instead of (a), the cost scales with how much real content has
been ingested before the switch — a factor for Phase 4 CAREGIVER-corpus volume, not
Phase 3.

## What this decision does NOT unlock

- Real content ingestion — still gated on Tranche 3C existing. 3D + 3C together form
  CLAUDE.md's hard gate; this record is half of it.
- `phiAllowed = true` — itself a future gate requiring an actual signed BAA (either
  path) to be provisioned first, never a convenience toggle to unblock a pipeline
  that "needs" PHI capability.

## Reopen trigger

> **The moment any CAREGIVER-sensitive or client/family/elderly content is slated to
> flow, this decision reopens — the choice between the OpenAI-BAA/ZDR path and the
> Azure path must be made, and whichever is chosen must be provisioned before that
> flow — per CLAUDE.md's hard gate.**

## Named future obligations (Phase 4+, recorded now so they aren't discovered late)

**ZDR is not default.** On the OpenAI-BAA path, a single embedding call made without
Zero Data Retention explicitly enabled is outside BAA scope even with a signed BAA in
place. When that path opens, "ZDR enabled on every call" must become a code-enforced
invariant through the existing provider-boundary/`assertPhiSafe` seam — the same
per-call discipline already applied to the surface boundary (Tranche 3A) — never left
as a convention or a one-time account setting assumed to cover every request.

**The vector store is our problem, not the provider's.** HIPAA-eligibility from
either path (OpenAI-BAA/ZDR or Azure) covers *generating* the embedding — it says
nothing about the `pgvector` store holding the resulting vectors afterward. A
compliant PHI vector store (encryption at rest, RLS scoped correctly for PHI-bearing
rows, a real deletion/retention discipline) is a separate Phase 4+ obligation this
project owns regardless of which provider ultimately signs the BAA.

## Open, not closed by this record

- Which PHI path (OpenAI-BAA/ZDR vs. Azure) will actually be chosen — deferred until
  a real PHI flow is slated, not a decision to make speculatively now.
- Account-specific OpenAI BAA scope, pricing, and turnaround — confirm directly with
  OpenAI sales when the path actually opens, not from this record.
- The eventual PHI-capable switch likely covers **two** providers, not one: this
  record is about `EmbeddingProvider` only. Phase 4's Gate 3 (LLM answerability) will
  need its own provider decision — `LLMProvider` has no implementation anywhere in
  this codebase yet, aspirational text in CLAUDE.md only. Whichever PHI path is
  chosen for embeddings does not automatically cover the LLM call Phase 4 will add.

## Dependency handoff to Tranche 3C — unchanged

Because no PHI-capable path is provisioned and `phiAllowed` stays `false`, **3C's
guard is the entire legal/compliance barrier on this path — not defense-in-depth
alongside a BAA, the only layer.** This sets a strict bar: 3C cannot be a best-effort
pattern-matcher that "usually catches the obvious stuff." An "uncertain" detection
result should route to block/quarantine, not pass-with-a-warning, precisely because
there is no BAA safety net underneath it to fall back on if it's wrong. This holds
regardless of which PHI path is eventually chosen — until one is actually
provisioned, the guard is what stands between real content and a non-BAA-covered
provider.
