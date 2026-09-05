# Known Issues

## Caregivers cannot see open/unassigned shifts (`AvailableShifts` returns 0 rows)

**Status:** Pre-existing, confirmed 2026-08-28. Not related to the `ai_match_score`
removal, the `callLLM` refactor, or the `56fbfe38` demo-data seed — all three of
those were verified working before this was found.

**Symptom:** A caregiver logged in and viewing `/available-shifts` ("Pick up extra
shifts to increase your earnings") sees "0 shifts available" regardless of how many
`open` shifts actually exist in their agency. Confirmed against the `56fbfe38` demo
data: staff (`munkh.mn@gmail.com`, agency_admin) correctly see all 3 open shifts on
the same page; a caregiver (`dana.reyes@caremuch-test.com`) sees 0.

**Root cause:** `src/pages/AvailableShifts.tsx` queries `shifts` directly
(`supabase.from("shifts").select(...).eq("status", "open")...`), with no RPC in
between — visibility is entirely governed by RLS on `public.shifts`. The current,
authoritative policy set (nothing later in migration history touches `shifts`
policies) is defined in
`supabase/migrations/20260821020140_73f4d17c-9e32-4783-ada4-7f396670ad55.sql:54-65`:

```sql
CREATE POLICY "Agency staff manage shifts in their agency"
ON public.shifts FOR ALL TO authenticated
USING (public.is_agency_staff(auth.uid()) AND agency_id = public.current_agency_id())
WITH CHECK (public.is_agency_staff(auth.uid()) AND agency_id = public.current_agency_id());

CREATE POLICY "Caregivers read their own assigned shifts"
ON public.shifts FOR SELECT TO authenticated
USING (public.is_my_assigned_shift(id));

CREATE POLICY "Clients read their own shifts"
ON public.shifts FOR SELECT TO authenticated
USING (client_id IN (SELECT public.my_client_ids()));
```

Three policies: staff get full agency access, clients get their own shifts, and
caregivers get **only shifts already assigned to them** (`is_my_assigned_shift()`
checks `shift_assignments`). There is no policy granting a caregiver `SELECT` on a
shift that is `open`/`unassigned` and not yet theirs — so RLS silently returns zero
rows, and the page's "pick up extra shifts" flow is non-functional for every
caregiver in the app, not caused by any specific tenant's data.

**Not the same gap as `caregiver_pick_up_shift()`:** the RPC itself
(`supabase/migrations/20260821045535_...sql`) already contains its own eligibility
check via `check_assignment_eligibility()` and would presumably work if a caregiver
could reach it with a shift id — the blocker is earlier, at the browse/list step:
a caregiver can't discover which shifts exist to pick up in the first place.

**Open product question this depends on, before writing the fix:**

> Should a caregiver see **all** open shifts in their agency (broadest, simplest
> policy — matches how `AvailableShifts.tsx` is written today, with no
> skill/service-area filtering in the query), or **only** shifts they're actually
> eligible for (skills match, service-area/zip match, no schedule conflict — i.e.
> pre-filtered by something equivalent to `check_assignment_eligibility()`)?

That decision changes the shape of the fix:
- "All open shifts" → a straightforward additive SELECT policy
  (`status IN ('open','unassigned') AND agency_id = caregiver's own agency`).
- "Only eligible shifts" → either a more complex RLS policy embedding skill/
  service-area logic, or moving `AvailableShifts.tsx` off a direct table query and
  onto a `SECURITY DEFINER` RPC that runs `check_assignment_eligibility()`-style
  filtering server-side (closer to what `match-caregiver`/`caregiver_pick_up_shift`
  already do) — a bigger change, more consistent with how eligibility is enforced
  everywhere else in scheduling.

**Deliberately out of scope for now** — tracked here to fix as its own scoped task,
separate from the Phase 0/Phase 1 multi-agent architecture work.

## match-caregiver has no real proximity signal (zip-in-list only, not distance)

**Status:** Known limitation as of the PHI-removal fix to `match-caregiver`
(2026-09-01). Not a regression — the previous LLM-based version's `distance_miles`
field was never a real calculation either (see below); this just makes the gap
explicit instead of papering over it with a hallucinated number.

**Symptom:** `serviceAreaScore` in `supabase/functions/match-caregiver/index.ts` is
binary — it only checks whether the client's zip code is present in the caregiver's
`service_zipcodes` list. Two caregivers who both serve a zip score identically on
this factor regardless of whether one lives 2 miles away and the other 20.

**Root cause:** No coordinate data exists anywhere in the schema for caregivers or
clients — only zip/city/state/address text fields (confirmed by repo-wide grep for
`latitude`/`longitude`/`geocode`, zero matches). The prior LLM-based matcher had the
same underlying gap: it asked the model to output a `distance_miles` number, but
never supplied caregiver location data in the prompt for it to compute from — that
field was a hallucinated guess, not a real calculation, and has been removed
rather than replaced.

**What a real fix requires (increasing effort/cost):**
1. Zip-centroid lookup table + haversine distance — no new user-entered data, only
   zip-level accuracy.
2. Geocode caregiver/client addresses to real `latitude`/`longitude` columns +
   haversine distance — needs schema changes and a geocoding step on save.
3. Real drive-time/distance via a routing API (Google/Mapbox/OSRM) — most accurate,
   introduces an external dependency and cost.

Each option also needs its own falloff curve (how much a mile of distance should
cost in the match score) and a decision on where it sits in the existing weighted
formula (`WEIGHTS` in `match-caregiver/index.ts`).

**Deliberately out of scope for now** — tracked here as a scoped follow-up, separate
from the PHI-removal fix that prompted this note.

## SECURITY: batch-create-users looks like unsafe leftover dev tooling

**Status:** Found while auditing user-provisioning paths for the `my_agency_id()`
isolation invariant (2026-09-02). Not fixed — flagged for a security review, not
addressed as part of that work.

**Symptom / risk:** `supabase/functions/batch-create-users/index.ts`:
- Has **no caller authentication or role check at all** — it doesn't read the
  `Authorization` header or call `get_user_role`, unlike every other admin-facing
  Edge Function in this repo (`create-user`, `enable-client-login`,
  `approve-caregiver-registration` all require `system_admin`/`agency_admin`/`manager`).
- **Deletes every auth user** except a hardcoded preserved list (`munkh.mn@gmail.com`
  plus any `system_admin`), then recreates all clients/caregivers under a single
  **hardcoded** `agencyId` (`56fbfe38-...`).
- Uses a **hardcoded default password** (`"123456"`) for every recreated account.

This reads as a one-off dev/reset script (mass-wipe-and-reseed a single demo agency),
not a safe production provisioning path. If it's reachable in a deployed environment
with its current lack of auth, anyone who can invoke it can delete every user account
in the project and reset all client/caregiver credentials to a known password.

**Action needed:** audit whether this function is deployed to any non-local
environment and, if so, whether it should exist at all in its current form — either
remove it, gate it behind the same admin auth check every other provisioning function
has, or restrict it to a local/dev-only deployment path.

**Deliberately out of scope for now** — tracked here as its own security-review task,
separate from the isolation-invariant fixes (`3468eb1`, `8ce68bd`) that surfaced it.

## AddUser.tsx leaves new staff with profiles.agency_id = NULL

**Status:** Found in the same audit (2026-09-02). Lower priority, orthogonal to the
knowledge-base isolation work.

**Symptom:** `src/pages/AddUser.tsx` creates staff accounts (system_admin, agency_admin,
manager, scheduler, hr_staff) via a direct client-side `supabase.auth.signUp()` call
(line 66), passing only `full_name` in the signup metadata — never `agency_id`. The
`user_roles` insert that follows (line 82-85) also omits `agency_id`. Since
`handle_new_user()` only sets `profiles.agency_id` from
`raw_user_meta_data->>'agency_id'` (defaulting to `NULL` when absent), any staff member
created through this page ends up with `profiles.agency_id = NULL` and a `user_roles`
row with no `agency_id` — breaking `current_agency_id()` (and therefore `my_agency_id()`)
for that account, and likely most agency-scoped RLS policies.

**Not the same bug class as the caregiver/client provisioning gaps** fixed in `3468eb1`
and `8ce68bd` — those were cross-agency *reassignment* risks; this is a plain missing
value with no caregiver/client row to disagree with. `supabase/functions/create-user`
already does this correctly (sets `agency_id` on both `profiles` and `user_roles` from
the caller's own agency) — `AddUser.tsx` looks like an older, uncoordinated path that
predates it.

**Deliberately out of scope for now** — tracked here as a scoped follow-up.

## AUDIT NEEDED: other Lovable-dashboard-authored config may be missing (fourth instance found)

**Status:** Found while diagnosing why the Conversation Builder showed only one flow
tab (2026-09-02). Not yet audited systematically — logged so the remaining instances
get found by audit, not one feature at a time.

**Pattern, confirmed four times now:**
1. `.lovable/mcp/manifest.json`'s OAuth issuer pointing at a stale project ref
   (`jipsobxiblzgivjmtwtq`) instead of the current linked project
   (`rgeldgztadebgvrdhaqa`) — found early this session, file untracked from git in
   commit `98a8a71`.
2. `system_modules`/`role_permissions` rows for `conversation_builder` — the sidebar
   menu entry for the Flow Builder — never existed in any migration, confirmed absent
   from the live tables, restored as a migration in `20260902150000`.
3. The `family_intake` `conversation_flows` content itself (the 8-question family
   intake flow visible in old screenshots of the Lovable-hosted app) — never inserted
   by any migration, confirmed missing from the live `conversation_flows` table,
   being restored as its own migration.
4. `supabase/functions/mcp/index.ts:165` — the same stale project ref
   (`jipsobxiblzgivjmtwtq`) hardcoded into the bundled MCP OAuth issuer URL
   (`https://${projectRef}.supabase.co/auth/v1`), baked in at Vite-plugin bundle
   time and never updated when the project moved to `rgeldgztadebgvrdhaqa` — found
   during the Phase 2 readiness pass (2026-09-03) while inspecting why this file
   kept self-mangling. Not yet fixed; logged here alongside instance 1 since it's
   the same stale ref, just baked into a second, generated location.

**Root cause:** any configuration or content authored directly through Lovable's
hosted dashboard/editor — not written as a tracked migration — lives only in that
project's live database. It was never captured in version control, so it had no way
to survive the move to a different Supabase project ref. The code and schema for
features 2 and 3 were always intact; only UI-authored *data* was lost. Instances 1
and 4 are a related but distinct sub-case: not lost data, but a project ref value
baked into generated/bundled output at authoring time, never re-derived after the
project moved.

**What to audit:** anything else editable through an admin screen that might also have
been authored this way and could be silently missing or incomplete — other
`system_modules`/`role_permissions` rows, `virtual_office` branding/settings entered
through its config UI, `care_types`/`care_needs`/`certifications` catalog entries added
via an admin screen rather than a migration, notification templates, agency settings,
or any other conversation flow beyond `caregiver_screening`/`family_intake`.

**Recommended approach:** a systematic audit — for each admin-editable table, compare
what migrations say should exist against what's actually live — rather than continuing
to discover gaps reactively, feature by feature.

**Deliberately out of scope for now** — tracked here as its own audit task.

## FamilyIntakeSurface.tsx lacks dynamic-catalog question support

**Status:** Found 2026-09-03 while restoring the `family_intake` conversation flow.

`FamilyIntakeSurface.tsx` lacks the dynamic-catalog question support
(`isDynamicSource`/`DynamicQuestion`) that `ConversationSurface.tsx` has — so family
intake can't use live `care_types`-sourced questions yet. Q2 ("What kind of help is
needed?") is seeded as a static snapshot of `care_types` as a workaround. Reconcile
during the UX redesign (the two surface components should share dynamic-question
capability). Also: family-intake `dynamic_item_ids` → `care_requests` wiring was not
fully traced — verify if/when dynamic questions are enabled for family intake.

**Deliberately out of scope for now** — belongs in the planned UX/UI redesign, not a
one-off patch to the migration that restores this flow's content.

**Q7-shape gap:** a `single_select` node with `options` AND `allow_free_text` discards
the free text — tapping an option submits immediately without reading the textarea
(`onPick` doesn't pass `freeText`). The "anything else" note can't save as-is. One-line
fix (`onPick` pass `freeText` through), deferred to the UX redesign's
`FamilyIntakeSurface` reconciliation. Family intake Q7 is seeded with this known
limitation; the 5 concern options work, the optional note doesn't save yet.

These two gaps (dynamic-catalog support, and this one) both live in the same
component and cluster together — the UX redesign reconciling `FamilyIntakeSurface`
with `ConversationSurface` (which already handles both correctly) would fix both at
once, which is why neither is being patched individually now.

**Single-full-name-field gap (fixed as an interim workaround, real fix deferred):**
`FamilyIntakeSurface`'s contact form captures one "Full name" text field and
`flow_session_submit_intake` splits it programmatically into `first_name`/`last_name`
for `family_contacts`. A single-word name (no space) made `last_name` compute to
`NULL`, violating `family_contacts.last_name NOT NULL` and surfacing as a generic
"We could not send your request" toast with the real Postgres error only visible in
the console. Root cause is the single-field design itself — `CaregiverRegistration.tsx`
avoids this entirely with separate `firstName`/`lastName` inputs, which is the correct
long-term fix and belongs in the UX redesign alongside the other two
`FamilyIntakeSurface` gaps above. `family_contacts.last_name` was deliberately left
`NOT NULL` (not loosened) — it's a codebase-wide convention shared by
`caregivers`/`clients`/`caregiver_registrations`, and `FamilyDialog.tsx`'s `Contact`
interface already assumes it's always a real string. Interim fix applied
(`20260903130000`): the RPC falls back to `''` instead of `NULL` when no last name is
derivable — satisfies the constraint, renders as a harmless trailing space wherever a
contact's name is displayed, no schema change. Also fixed alongside it: `submitIntake`
now returns the real error message instead of a bare boolean, so `FamilyIntakeSurface`
can surface the actual Postgres error in its toast instead of a generic one — this bug
was only diagnosable by reading the browser console before that fix.

## FUTURE PROJECT (out of scope): CareMuch platform marketing site rebuild

**Status:** Logged 2026-09-03 as an explicit scope boundary while designing the unified
public assistant for an agency's own page (`/a/:slug`, e.g. `/a/kind-care`).

The unified-assistant work (router + caregiver screening + family intake + knowledge
Q&A) is scoped to a single agency's public page (`PublicOffice.tsx`). The separate
CareMuch platform marketing site (the top-level `/` landing page and its own copy/design,
distinct from any individual agency's branded page) is a different, larger piece of work
— not touched, not designed, not scheduled as part of this phase.

**Deliberately out of scope for now** — tracked here as its own future project to pick
up separately, so it isn't conflated with or accidentally scope-crept into the
per-agency assistant work.

## DEFERRED: knowledge base embedding backfill has no global cross-agency path

**Status:** Logged 2026-09-04 while building `backfill-knowledge-embeddings` (Phase 2
Tranche C part 3b). Deliberate design choice, not a bug — deferred because no need for
it exists yet.

**Design:** `backfill-knowledge-embeddings` authenticates as the calling staff member's
own session (their JWT forwarded through, not `service_role`) and relies entirely on the
existing staff-only, agency-scoped RLS policy on `knowledge_chunks` (`20260902120000`)
as the tenancy boundary. This is the correct least-privilege choice for a routine,
per-agency operation: it can't write outside the caller's own agency even if the
function's own filtering logic has a bug, because RLS enforces that regardless.

**Consequence:** there is no single invocation that backfills *every* agency's chunks at
once — it must be run once per agency, by that agency's own staff. Today that's a
non-issue (only agency `56fbfe38` has knowledge base content), but it becomes relevant
the moment there are many agencies with real content and a reason to re-embed all of
them at once — most likely a future embedding model/provider change (e.g. the OpenAI →
Azure swap), which would invalidate every agency's existing vectors simultaneously.

**What a global path would require:** a separate, more privileged admin function,
mirroring `purge_demo_data()`'s existing pattern (`SECURITY DEFINER`, explicit
`system_admin`-only role gate) rather than RLS-scoped-as-caller — deliberately crossing
the per-agency RLS boundary under an explicit, audited gate, not a silent `service_role`
bypass.

**Deliberately out of scope for now** — no multi-agency knowledge content exists yet to
motivate building it; tracked here so the need is recognized instead of rediscovered
when the model/provider eventually changes.

## Semantic retrieval (3c) live-testing observations — inputs for the eval sub-tranche

**Status:** Logged 2026-09-04 during live testing of `search-knowledge` (Phase 2 Tranche C
part 3c, the FTS → cosine-similarity swap). Not bugs — observations to feed the formal
30-50 question eval that comes next, so they're recognized as eval inputs instead of
rediscovered mid-eval.

**Top-1 retrieval is phrasing-brittle when two chunks score close.** "can't make it to my
shift" correctly grounds to the Attendance/Call-Off Policy (the ideal document). The
same underlying intent phrased as "can't make my shift" instead surfaces a PTO chunk as
top-1 — a near-miss, not a refusal. `search-knowledge`/`match_agency_knowledge` already
fetch `_limit` (default 5) ranked rows and discard everything but index 0 — a candidate
case for surfacing top-k instead of top-1-only once there's a UI/UX reason to (see the
disambiguation-UX analysis below), since the plumbing for it already exists.

**The Call-Off vs. PTO-mentions-call-off pair is a good ambiguous/near-miss eval
question** — worth including explicitly in the 30-50 question eval set as a case
designed to probe this exact top-1-vs-top-k boundary, not just answerable/unanswerable
extremes.

**`SEMANTIC_MATCH_THRESHOLD` (0.3) remains provisional and untested against a real
refusal case.** Every live UI test so far has been a genuinely answerable question; no
live test has yet exercised the semantic path's refusal behavior (an out-of-domain or
unanswerable question scored against real content). The eval must include unanswerable
cases specifically to validate the threshold does what it's meant to, not just that
answerable cases pass.

## FUTURE PHASE 1G: manager document upload is not just a file uploader

**Status:** Logged 2026-09-04 while reviewing the Phase 2 Tranche C part 3d eval question
set, scoping ahead to Phase 1G per CLAUDE.md's roadmap ("Phase 1G (real agency document
ingestion — the first time uncontrolled real content enters the pipeline)").

**What's being asked for:** a manager-facing upload path for real agency knowledge —
FAQ Q&A content (Excel/Word/plain text), policies, safety rules, holiday calendars, and
retention/referral/bonus/salary documents. Unlike the current 32-chunk seed corpus (hand-
written, deliberately PHI-free, uniform plain-text paragraphs), this is real, manager-
authored content in mixed formats, arriving uncontrolled.

**Three separate blockers, not one uploader feature:**
1. **Multi-format parsing.** Excel Q&A pairs, Word policy documents, plain text, and
   presumably PDF are structurally different — a tabular FAQ spreadsheet needs different
   extraction/chunking logic than prose policy text. No parsing strategy exists yet for
   any format beyond the plain-text `content` field the seed migration hand-wrote.
2. **The PHI/PII ingestion guard CLAUDE.md's hard gate mandates.** This is explicitly
   the trigger CLAUDE.md names for the HIPAA/PHI boundary hard gate — the seed corpus is
   PHI-free by construction (hand-authored, reviewed), but a real manager-uploaded
   salary document, holiday calendar, or retention note could contain real PHI/PII by
   accident (an employee SSN in a salary doc, a client name slipped into a retention
   note) with nothing currently stopping it. The guard from CLAUDE.md's "Phase 1 RAG =
   PHI-FREE" diagram (PHI/PII Guard → REJECT/ALLOW, before chunking) does not exist in
   code yet — only the schema-level guarantee (no `client_id` path) exists, and that only
   protects against a structural PHI channel, not content accidentally typed into an
   otherwise-legitimate document.
3. **The provider/BAA question this forces.** The current `EmbeddingProvider` is
   OpenAI-direct with `phiAllowed: false`, hard-enforced (Phase 2 Tranche C part 3a). If
   real uploaded documents could carry PHI, embedding them through OpenAI-direct would
   violate the hard gate outright. Shipping this feature requires either (a) a guard
   reliable enough to give real confidence content is PHI-free before it ever reaches
   `provider.embed()`, or (b) provisioning Azure + a signed BAA first, per CLAUDE.md's
   explicit gate — not something to decide implicitly by just building the upload UI.

**Deliberately out of scope for now** — Phase 1G work, not started; tracked here so the
scope is recognized as three separate problems (parsing, guard, provider decision) before
anyone starts by just building a file picker.

## SEMANTIC_MATCH_THRESHOLD (0.40) is proof-of-concept, derived on private-policy placeholder content

**Status:** Logged 2026-09-05 after the Phase 2 Tranche C part 3d eval
(docs/phase2-rag-eval-analysis.md).

The 38-question eval that set `SEMANTIC_MATCH_THRESHOLD` ran entirely against the seed
corpus (Attendance/Call-Off, PTO, Dementia SOP, Medication Guidelines) — hand-authored
placeholder content proving the retrieval mechanism, not the public `/a/:slug` agent's
real corpus (which will be FAQ/services/careers content, per the CareMuch Phase 2 RAG
Architecture Decision doc). This threshold should not be assumed to transfer.
`rag-eval-harness` is kept in the repo specifically to re-run this eval and re-derive τ
once real public content is seeded.

**Deliberately out of scope for now** — no public corpus exists yet to re-derive against.

## PRE-PRODUCTION GATE: no knowledge-authorization scope exists — search-knowledge serves private content to anonymous visitors

**Status:** Logged 2026-09-05 during Phase 2 Tranche C part 3d review, after reading the
CareMuch Phase 2 RAG Architecture Decision doc's §1–§3 and §6. This is a REQUIRED
PRE-PRODUCTION GATE, not a settled decision and not a deferred nice-to-have — tracked
here so it is resolved before the public agent ever serves a real agency.

**Current state:** `search-knowledge`/`match_agency_knowledge` enforce agency isolation
only (Gate 1: which agency's knowledge). No knowledge-authorization gate exists in any
form (the architecture doc's own further distinction: which knowledge *within* that
agency the caller may see). The entire 32-chunk seed corpus — which the architecture
doc's §2 classifies as CAREGIVER-scope, private content (PTO, call-off, dementia SOP,
medication) — is served to any anonymous `/a/:slug` visitor with no restriction
whatsoever. Per the doc's §1 ("How many PTO hours do caregivers receive? ... MUST REFUSE
for an anonymous visitor"), this is presently in violation of the architecture decision,
not a hypothetical future gap.

**Why this hasn't caused real harm so far:** the seed corpus is dev/placeholder content
used to prove the retrieval mechanism (docs/phase2-rag-eval-analysis.md §8) — there are
no real users, and no real agency's actual private content is exposed. **This is
acceptable ONLY under those conditions.**

**Planned mechanism (not yet built, not yet decided as final):** separate corpora per
surface — the public `/a/:slug` agent ingests only public FAQ/services/careers content;
private caregiver-policy content is ingested only for the authenticated caregiver coach
(Phase 4). This would be a structural alternative to the architecture doc's §6 per-chunk
PUBLIC/CAREGIVER/STAFF-ADMIN classification, intended to satisfy the same §1–§3
requirement (knowledge authorization enforced server-side) by a different mechanism
(separation at ingestion rather than a scope column checked at query time). Which of the
two actually gets built is an open question — only that one of them must be, before
production.

**REQUIRED PRE-PRODUCTION GATE:** before the public agent ever serves a real agency's
real content, either (a) the public corpus must be structurally public-only
(separate-corpora plan), or (b) §6's per-chunk/per-document scope classification must be
built and enforced in `match_agency_knowledge`. Shipping real agency content through the
current anonymous `search-knowledge` path with neither in place would mean any private
policy document an agency uploads becomes visible to anonymous visitors purely because
it's semantically similar to their question — exactly the failure the architecture doc's
§6 warns against.

**Tracked as a pre-production requirement, not deferred/out-of-scope** — must be resolved
before Phase 1G real document ingestion for the public agent, not just "someday."
