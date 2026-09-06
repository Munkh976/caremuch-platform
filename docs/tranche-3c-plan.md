# Tranche 3C — PHI/PII Guard: Complete Plan (Authoritative)

> **Status: APPROVED — IMPLEMENTED.** This document merges the original 13-section
> Tranche 3C plan with its later revisions (attestation server-enforcement, dropped
> Layer 3, the Conditional-A retrieval-mode decision, and the revised Layer 1 pattern
> set) into one complete, standalone record. It supersedes and replaces
> `Tranche 3C — Revised Plan Sections.md` (a changed-sections-only fragment), which is
> retired in the same commit that implements this plan. The MRN pattern (§7.5), open
> at initial approval, is recorded below as resolved during implementation.

## 1. Executive Summary

The guard must fail closed on every non-SAFE state, per the fixed 3D handoff: it is
the sole legal barrier, not defense-in-depth alongside a BAA. Two detection layers,
not three: **structured-PII regex** (bilingual, both paths, four patterns — SSN,
phone, email, DOB — each individually threat-modeled; MRN dropped, credit-card
dropped) and **server-enforced human attestation** (ingestion only, exact-string
match, no default, validated before any Storage access, audit-logged). A third "weak
name heuristic" layer was considered and explicitly excluded — it added machine
friction ahead of a human judgment that already does the job better, and could never
clear content, only delay it.

The anonymous query path ships in **Option A / VECTOR mode** for 3C — under a
load-bearing Layer 1 guard — as a **conditional, not permanent, architecture
decision**. `search-knowledge` exposes a policy-controlled `retrieval_mode = FTS |
VECTOR` seam, defaulting to `VECTOR`, with the existing Postgres FTS path wired and
ready. At **3G**, before real anonymous traffic is exposed to real public content,
the two modes are re-measured against the *actual* public corpus using the existing
eval harness — a decision made on evidence about that corpus, not on the
caregiver-corpus measurements that motivated semantic retrieval in the first place,
and explicitly **not gated on BAA/provider status**. The residual name/context-PHI
risk on the query path is accepted **only for the 3C→3G window**, not permanently,
and must never be recorded as proof that deterministic detection establishes PHI
absence.

## 2. Current-State Analysis

Two `embed()` call sites: `ingest-knowledge-document` (batch, staff-authenticated,
synthetic-only per 3B) and `search-knowledge` (anonymous, real-time, public). Both
call `assertPhiSafe()` immediately before `embed()`, both hardcode `requiresPhi:
false`. Ingestion's user-influenced free-text fields: `title`, `filename`. Query
path's sole field: `query`. Corpus is bilingual by schema constraint (`CHECK
(language IN ('en','es'))`), confirmed structurally.

## 3. Query-Path Architecture — Conditional-A, Re-Measured at 3G

**Decision:** ship Option A (embed via OpenAI-direct under a Layer 1 guard) for 3C,
not permanently — re-measured at 3G. The asymmetry that motivated evaluating
alternatives still holds: ingestion is staff-controlled, batch, latency-tolerant, and
can afford a human-in-the-loop control; the query path is anonymous, real-time, and
sits on the hot path of every public question, where a false positive refuses a live
visitor's question with no recourse — this is why the two paths never shared one
mechanism, and still don't.

**Why Conditional-A instead of committing to FTS-only, or leaving the choice open
indefinitely:** the public corpus (which `search-knowledge` is hardcoded to serve
exclusively, `_surfaces:['public']`) is PHI-free by design — coupling its retrieval
quality to an unrelated compliance milestone (BAA status) would be a category error.
The documented FTS-vs-semantic overlap (correct-answer band 0.0122–0.0695 vs.
noise-ceiling band 0.0087–0.0405, FTS's own worst false positive exceeding its own
weakest real answer) is real, quantified evidence — but it was measured against the
*caregiver* seed corpus, not the real public corpus, which will contain materially
different content (services, service areas, careers, application process) that may
be far more FTS-separable. The correct move is to measure the actual corpus before
permanently choosing, not to guess in either direction now.

**Mandatory gate at 3G:** seed the real public corpus → run the existing eval harness
against it → measure FTS and VECTOR signal/noise separability on *that* corpus →
record the result → set `retrieval_mode` accordingly.

```text
                    3G public-corpus evaluation
                              │
               ┌──────────────┴──────────────┐
               │                             │
       FTS separates cleanly          FTS does not separate
               │                             │
               ▼                             ▼
       retrieval_mode=FTS             retrieval_mode=VECTOR
               │                             │
               ▼                             ▼
       zero external query            semantic embedding
       egress for anonymous           remains on public path
       retrieval
```

FTS separates cleanly → switch to FTS (closes query-text egress structurally, at no
material quality cost). FTS does not separate cleanly → confirm VECTOR, with the
Layer 1 guard remaining exactly as it is now.

**The retrieval-mode seam (3C build requirement, additive to the guard work):**
`search-knowledge` exposes a policy-controlled `retrieval_mode = FTS | VECTOR`
abstraction — not a code rewrite at 3G, a config/policy flip. `VECTOR` is 3C's
default; `FTS` (the existing `search_agency_knowledge` path) is fully wired and
available, not stubbed — confirmed during implementation that `search_agency_
knowledge` already carries the same required `_surfaces` parameter and
anon/authenticated EXECUTE revocation as `match_agency_knowledge`, both from the same
3A migration, so wiring FTS as an alternative mode was a config branch, not a
surface-isolation build item. The Layer 1 guard sits in front of *both* modes
identically — it is not removable if FTS is eventually chosen, because a
name/context-tied query could still be logged/processed within the system even
without external egress, and the guard's structured-pattern protection is orthogonal
to which retrieval backend is used.

**Residual-risk framing, precisely:** *"Residual name/context-PHI risk is accepted
temporarily while the conditional-A architecture is measured against the real public
corpus. This acceptance expires at the 3G gate."* This must never be recorded as a
permanent accepted risk, as evidence that deterministic detection proves PHI
absence, or as something contingent on BAA verification — the 3G measurement, not
the BAA timeline, is what resolves it.

## 4. Detection Boundary — before chunking, full combined field set

Inspect `{title, filename, normalized body text}` as one unit, before `chunkText()`
splits it. This closes the mechanical case where a structured pattern (e.g., a
formatted SSN) straddles exactly where a chunker would split it — a whole-document
check sees the complete pattern; a per-chunk-only check would see two non-matching
fragments. This does **not** solve the semantic version of the same question — a
name in one part of a document correlated with an unrelated-looking identifier
elsewhere — because no regex, whole-document or per-chunk, performs entity
correlation. That gap is the same underlying limitation as name/context detection
generally, closed (for ingestion) by attestation, not by the boundary choice.

## 5. Field Inventory

| Field | Path | User-influenced | Coverage |
|---|---|---|---|
| `title` | Ingestion | Yes | Pre-chunk combined check |
| `filename` | Ingestion | Yes | Pre-chunk combined check |
| Extracted body text | Ingestion | Yes | Primary target |
| Chunk text | Ingestion | Derived | Covered transitively (chunking only splits) |
| `category` | Ingestion | **No — hardcoded `'ingested'`** | No check needed today; **must be added the moment this becomes editable** |
| `language`, `surface`, `replace_document_id` | Ingestion | No — constrained | Not free text, no check needed |
| `query` | Query | Yes | Sole field, checked pre-embed |
| `agency_id` (query) | Query | No — page context | No check needed |

## 6. Bilingual Detection

Structured patterns (§7) are language-agnostic by construction — a phone or SSN
shape doesn't depend on surrounding language, so both `en`/`es` get full coverage
from Layer 1 alone. Name/context detection is unreliable in *both* languages for the
same reason (dictionary-based name matching has a high false-negative rate
regardless of which language's dictionary), which is precisely why Layer 3 was
excluded outright rather than built as an English-only or asymmetric mechanism
(§7.7).

## 7. Layer 1 Pattern Set — Per-Pattern Threat Model

Every surviving pattern carries a concrete CareMuch relevance argument, a stated
false-positive risk (especially on the query hot path), and a stated false-negative
limitation — "catches obvious identifiers" is not sufficient on its own, and is not
claimed as such.

### 7.1 SSN-shaped — KEEP
**Relevance:** high-value personal identifier, plausible in care records. **FP
risk:** low but nonzero. **FN limitation:** only formatted (xxx-xx-xxxx)
representations match; unformatted 9-digit sequences do not, to avoid colliding with
other 9-digit numbers.

### 7.2 Phone-shaped — KEEP, bounded
**Relevance:** plausible in home-care records and communications. **FP risk:**
moderate — policy documents can legitimately contain phone numbers; particularly
relevant on the anonymous query hot path. **FN limitation:** mixed separators,
bare country codes, and nonstandard formats do not match — patterns are bounded, not
a general-purpose phone matcher.

### 7.3 Email-shaped — KEEP
**Relevance:** can identify clients, family members, caregivers, or staff. **FP
risk:** low-to-moderate — public agency contact addresses are syntactically
indistinguishable from private ones. **FN limitation:** malformed/obfuscated
addresses, or a local part exceeding 64 characters, will not match.

### 7.4 DOB/date-shaped — KEEP, constrained
**Relevance:** a direct personal identifier. **FP risk:** higher than SSN — dates
are common in legitimate policy/training content. **FN limitation:** constrained to
recognizable numeric DOB representations (MM/DD/YYYY, MM-DD-YYYY), not every date in
running text (e.g. "March 3, 2026" prose form is not matched).

### 7.5 MRN / care-record-identifier-shaped — **RESOLVED: DROPPED**
**Relevance (if it existed):** would be directly relevant if CareMuch received or
could receive care-record identifiers. **Resolution, per this plan's own rule:** KEEP
only if the implementation can tie the pattern to a concrete, tightly bounded
CareMuch identifier format; otherwise DROP rather than fall back to an unbounded
generic long-digit-sequence rule (which would catch ZIP codes, policy numbers,
version numbers, years, and phone numbers). **Outcome, confirmed during
implementation:** a repo-wide grep for `MRN`, `medical_record`, `record_number`,
`case_number`, and `client_number` (2026-09-05/06) found zero matches anywhere in
this codebase outside the planning documents themselves. No concrete CareMuch
identifier format exists to bound the pattern against, so it was **dropped, not
built** — there is no MRN detector in `phiGuard.ts`, and no unbounded fallback was
used to claim coverage that isn't real.

### 7.6 Credit-card-shaped — DROP
No concrete CareMuch threat rationale was established — a home-care knowledge
corpus has no payment-card handling context that makes this a realistic accidental-
PHI vector, unlike SSN/phone/email/DOB. Not included in the Layer 1 detector or the
test fixture set.

### 7.7 Layer 3 name dictionary — EXCLUDED
Not deferred — excluded outright. Names and context-tied PHI remain outside the
reliable deterministic detection boundary this plan establishes, in both languages
equally. The ingestion-side control for this gap is the required human attestation
(Layer 2, §9); the anonymous query path retains the explicitly documented residual
limitation during the 3C → 3G window (§3).

## 8. Detected-PHI Behavior, All Non-SAFE States

**Ingestion:**

| State | Behavior |
|---|---|
| Attestation missing/invalid | BLOCK before any Storage/extraction activity; `ingestion_error: "required attestation missing or invalid"` |
| PHI pattern match | BLOCK, quarantined, `ingestion_status:'failed'`, diagnostic `ingestion_error` naming the pattern class |
| Detection ERROR | BLOCK, `ingestion_error: "detection error"` |
| Oversized input | BLOCK, `ingestion_error: "input exceeds guard length cap"` |
| Unprocessable content | BLOCK, `ingestion_error: "unprocessable content"` |

**Query** (load-bearing under Conditional-A — a passing result means *only* "passed
deterministic structured controls for this path," never "proven PHI-free"):

```text
anonymous query
      │
      ▼
Layer 1 structured detector
      │
      ├── PHI match ───────────────► BLOCK
      ├── ERROR ───────────────────► BLOCK
      ├── UNPROCESSABLE ───────────► BLOCK
      │
      └── SAFE
           │
           ▼
       provider.embed(query)
```

The guard executes immediately before external embedding. A blocked query returns
the **identical** generic refusal `KnowledgeQaSurface.tsx` already shows for "not
grounded" — never revealing which detector fired, what matched, or that a block (vs.
a genuine unanswerable question) occurred at all, so the guard itself can't be probed
as an oracle. Query content is never persisted; audit telemetry carries only
non-content metadata (timestamp, agency_id, guard outcome, pattern class) — never the
raw query or matched substring.

## 9. Insertion Architecture

**Ingestion:** (1) validate `phi_attestation` — reject before Storage access if
missing/wrong; (2) download/extract/normalize (unchanged from 3B); (3) Layer 1 over
`{title, filename, normalized}` combined, before chunking; (4) result feeds the
existing `assertPhiSafe()` call, unchanged mechanically.

**Query:** Layer 1 over `query` alone, immediately before `assertPhiSafe()`/
`embed()`. **Additive scope:** `search-knowledge` also gains the `retrieval_mode =
FTS | VECTOR` seam (§3) — a config-driven branch after the guard passes, routing to
either `match_agency_knowledge` (VECTOR, default) or `search_agency_knowledge` (FTS,
wired but not default) — built in the same tranche as the guard, not a 3G surprise.

## 10. Testability Plan

Fixtures: SSN, phone, email, DOB, a chunk-boundary-straddling fixture (proves the
before-chunk boundary catches a pattern positioned at a chunk split), a clean/
negative fixture. No MRN fixture (pattern dropped, §7.5). No credit-card fixture
(dropped, §7.6). Query-path tests: structured-pattern queries (must refuse
identically to genuine unanswerable ones — verified via response-shape and latency
comparison against a real embedding call), ordinary queries (must not false-positive).
Attestation-bypass test: direct API call with `phi_attestation` omitted/wrong →
rejected before any Storage access, mirroring 3A's Step 0. Retrieval-mode seam test:
confirm the FTS path (`search_agency_knowledge`) returns correct, surface-scoped
results independent of the live `search-knowledge` default.

## 11. Risks and Open Decisions

- Attestation's ceiling remains staff honesty, now with a server-enforced,
  audit-logged control rather than an anonymous UI click.
- Regex pattern set will need periodic review as identifier formats evolve.
- Dropping `\b` word-boundary anchors (required after ingestion-side extraction
  artifacts were found to glue identifiers directly to surrounding text with no
  separator, defeating `\b`-anchored patterns) widens matching on both paths,
  including the query path — this raises the query-side false-positive rate (a
  legitimate question refused because of an incidental digit/character run) as an
  explicit, accepted trade against the alternative (a real identifier silently
  missed). Accepted as the correct fail-closed direction, not an overlooked cost.
- The 3G re-measurement is a **scheduled mandatory gate**, not an open risk — but it
  is a real dependency: 3E cannot expose real anonymous traffic to real public
  content before it runs.

## 12. Explicitly Out of Scope

The OpenAI-BAA/Azure/ZDR compliance track (Tranche 3D, closed). Real agency content
flowing through the pipeline (blocked until 3C ships *and* is verified — and, for the
public path specifically, until 3G's retrieval-mode measurement completes). Gate 3
(LLM answerability, Phase 4). The 3G retrieval-mode decision is **explicitly not
gated on BAA/provider status** — it is a corpus-quality measurement, decided
independently.

## 13. Dependency Handoff

3C hands 3E and Phase 4 a guard whose honest scope is: **reliable against structured
identifiers, bilingually; reliant on human attestation for name/context PHI at
ingestion; structurally unable to close the same gap on live queries.** Whoever
approves real content flowing through this pipeline needs to know that "the guard
passed" means "no structured identifiers found and staff attested," not "an AI
confirmed this document has zero PHI" — no such confirmation is possible under the
fixed no-LLM constraint. This ceiling is the single most important fact to carry
forward into the real-content decision.

3C additionally hands **3G** a query path structurally ready for either retrieval
mode via the `FTS | VECTOR` seam, entering 3G defaulted to `VECTOR` with `FTS` fully
wired. The 3G gate — not 3C — determines which one anonymous public traffic actually
uses, based on measuring the real public corpus, not the caregiver corpus this
plan's evidence came from. The Layer 1 guard remains mandatory under either outcome;
3C does not permanently commit the query path to semantic embedding.

```text
                3C
                 │
                 ▼
       retrieval-mode seam
          ┌─────────────┐
          │             │
        VECTOR          FTS
          │             │
          └──────┬──────┘
                 │
                 ▼
                3G
                 │
                 ▼
       Real public corpus evaluation
                 │
          ┌──────┴──────┐
          ▼             ▼
       FTS wins       VECTOR wins
          │             │
          ▼             ▼
       switch to      remain VECTOR
          FTS
```

The query guard remains mandatory regardless of which mode 3G selects — it sits
before Postgres FTS exactly as it sits before external embedding, because the guard
protects against structured identifiers being entered into the query at all, which
is orthogonal to which retrieval backend eventually consumes the (guard-cleared)
query.

## 14. Final 3C Decision Statement

> 3C implements the PHI/PII guard with deterministic structured detection on both
> ingestion and anonymous query paths. Ingestion additionally requires server-enforced
> human attestation (exact-string, no default, validated before Storage access,
> audit-logged). The anonymous query path initially uses semantic/vector retrieval
> under a load-bearing Layer 1 structured guard. `search-knowledge` exposes an `FTS |
> VECTOR` policy-controlled seam, defaulting to `VECTOR`, with `FTS` fully wired. At
> 3G, before real anonymous public traffic is enabled, both modes are re-measured
> against the actual public corpus using the existing evaluation harness; if FTS
> separates cleanly, anonymous retrieval switches to FTS, otherwise VECTOR remains.
> The anonymous name/context-PHI residual is accepted only for the 3C→3G window —
> not a permanent accepted risk, not BAA-gated. The MRN pattern (§7.5) was resolved
> during implementation to DROPPED: no concrete CareMuch identifier format exists to
> bound it against, and no unbounded fallback was used.

**Implemented.** Two additional findings surfaced during build-time verification, not
anticipated at planning time, and are recorded here for completeness (full detail in
`docs/known-issues.md` and the implementing commit): (1) an adversarial-input timing
probe run in the real Deno Edge Runtime found the phone and email patterns as
originally drafted were quadratic-time against adversarial input, not linear as
assumed — both were redesigned and re-verified; (2) the project's own
chunk-boundary-straddling test fixture caught a real false negative — `\b`
word-boundary anchors fail to match identifiers glued directly to surrounding text
with no separator (a realistic PDF/DOCX extraction artifact) — fixed by dropping the
anchors, accepted as a deliberate false-positive-rate increase in the fail-closed
direction (§11).
