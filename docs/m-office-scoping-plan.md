# M-Office — Virtual-Office Scoping: Verification & Fix Design

> **Status: PLAN ONLY. Nothing in this document has been applied.** Architecture
> approved; a fail-open vulnerability in the original §2 design (a NULL office read
> as "unrestricted," indistinguishable from a Tier-3 user whose office was never set)
> was found in review and is now fixed in §2 with a `CHECK`-constraint-backed,
> fail-closed design. All §6 decisions are resolved. Mirrors M1's discipline exactly:
> live-policy reads via a direct read-only Postgres connection (fresh credentials,
> `SELECT`-only, never reused across sessions), additive fixes following the
> codebase's own established helper pattern, a two-office isolation test — including
> an explicit fail-closed proof — as the actual done-definition, not a code review.
> STOP for review before any implementation.

## Root cause, confirmed live

`virtual_office_id` exists as a scaffolded column on 8 tables, is nullable everywhere,
and **zero RLS policies in the entire schema reference it** (confirmed via
`pg_policies.qual/with_check ILIKE '%virtual_office%'` — zero rows). Every symptom in
the brief traces to this one fact:

- **Knowledge contamination**: `match_agency_knowledge`/`search_agency_knowledge`
  filter only `d.agency_id = COALESCE(_agency_id, my_agency_id())` — `virtual_office_id`
  is already correctly populated on all 16 live `knowledge_documents` rows (0 NULL)
  but is never read by either retrieval RPC. This is a pure RPC-parameter gap, not a
  data gap.
- **"Unassigned office"**: `create-user` (the Edge Function M1 confirmed is the
  *correct* provisioning path) inserts `caregivers`/`clients` with `agency_id:
  callerProfile.agency_id` and **never touches `virtual_office_id` at all**. Live
  counts: `clients` 5 NULL / 5 total (100%), `caregivers` 1 NULL / 6. This isn't stray
  bad data — it's every caregiver/client ever created through the one correct
  provisioning flow, because that flow was never taught the office exists.
- **`/assistant` gap**: `flow_session_submit_intake` already takes
  `p_virtual_office_id` as a parameter and has an agency-level NULL-fallback (picks
  the one active agency), but **no office-level fallback** — it inserts whatever it's
  handed, which is NULL from `/assistant`.
- **`conversation_flows` manual swap**: unchanged from M2's existing scoping in
  `multitenant-saas-architecture-plan.md` — still global by design, still deferred,
  discussed again in §3c below only to extend M2's design one level, not to redo it.

## Tables WITH `virtual_office_id` today (live, confirmed)

| Table | Nullable | Live NULL / total |
|---|---|---|
| `care_request_time_windows` | YES | 0 / 0 (empty) |
| `care_requests` | YES | 0 / 3 |
| `caregiver_registrations` | YES | 0 / 5 |
| `caregivers` | YES | **1 / 6** |
| `clients` | YES | **5 / 5** |
| `events` | YES | 47 / 52 |
| `families` | YES | 1 / 3 |
| `knowledge_documents` | YES | 0 / 16 |

Real `virtual_office` rows (all under agency `56fbfe38`, plus one platform sentinel):
`Primary Office` (`17acb690…`, no slug, active — the pre-Ripple default),
`Kind Care Services` (`56785edd…`, slug `kind-care`, **`is_active=false`**),
`Ripple Effects Community Inclusion Center` (`12faa863…`, slug `ripple-effects`,
active). `virtual_office` itself already carries full per-office branding
(`branding`, `operating_hours`, `service_states`/`service_zipcodes`, `public_content`,
contact fields) and an `is_primary` flag — useful below as the NULL-fallback target
instead of inventing new fallback semantics from scratch.

`user_roles` and `profiles` have **no office column of any kind** today — confirmed
directly (`information_schema.columns`), which is the real gap the nested-tenancy
design below has to close.

---

## 1. Office-Scopability Map

Legend: ✅ office-scoped · 🔴 has the column, unenforced · 🆕 needs the column ·
🌐 correctly agency-level only.

| Table | Status | Notes |
|---|---|---|
| `caregivers` | 🔴 | Column present (1 NULL), zero RLS reference. Fix: add office-composed clause to "Agency users can manage their caregivers"; fix `create-user` to set it. |
| `clients` | 🔴 | Column present (5/5 NULL!), zero RLS reference. Same fix shape as `caregivers`. |
| `families` | 🔴 | Column present, zero RLS reference (current policy is agency-only, confirmed ✅ for agency in M1 but never checked for office). |
| `care_requests` | 🔴 | Column present, populated correctly (0 NULL) via the office-scoped `/a/:slug` path; RLS still agency-only. |
| `care_request_time_windows` | 🔴 (empty table) | Column present, no live rows to backfill; fix RLS pattern proactively so future rows are covered. |
| `caregiver_registrations` | 🔴 | Column present, 0 NULL live (manually backfilled per `known-issues.md`), RLS agency-only. Low urgency — small, staff-triaged table. |
| `knowledge_documents`/`knowledge_chunks` | 🔴 (documents), 🔴 (chunks inherit) | **Highest-value fix.** Column populated, RPCs ignore it — this is the literal Ripple/Kind Care contamination. |
| `events` | 🔴, low priority | 47/52 NULL — mostly unpopulated. Audit log, not an isolation-critical table; office attribution is a nice-to-have here, not required for the security proof. Address after the operational core, don't block on it. |
| `shifts` | 🆕 | No column. Recommend adding (denormalized, same precedent as `agency_id` living directly on `shifts` rather than only derived via `client_id`). |
| `shift_assignments` | 🆕 (indirect) | No own column (matches its existing `agency_id`-via-`shift_id` pattern) — derive via a new `shift_assignment_virtual_office_id()` helper mirroring `shift_assignment_agency_id()`, no new column needed on this table itself. |
| `client_orders` | 🆕 | No column; add, backfill from `client_id → clients.virtual_office_id`. |
| `order_services` | 🆕 (indirect) | Mirrors `order_agency_id()` — add `order_virtual_office_id()` helper, no new column. |
| `time_entries` | 🆕 | No column; add, backfill from `caregiver_id → caregivers.virtual_office_id`. |
| `time_off_requests` | 🆕 | Same shape as `time_entries`. |
| `caregiver_availability`/`_exceptions`/`preferences`/`certifications`/`skills` | 🆕 (indirect) | All already indirect via `caregiver_id`; no new column needed, only a helper mirroring `caregiver_agency_id()`. |
| `client_care_needs`, `family_contacts` | 🆕 (indirect) | Same shape, via `client_id`/`family_id`. |
| `client_time_windows` | 🆕 | Direct `agency_id` column exists; would need the same treatment as `client_orders` if Tier-3 needs to manage these — lower priority than the operational core. |
| `earnings_lines`, `shift_ratings` | 🆕, low priority | Reporting/financial rollups; office-scoping these matters once Tier-3 exists but isn't required to prove the mechanism — sequence after the core. |
| `conversation_sessions`/`conversation_answers` | 🆕 | `conversation_sessions.agency_id` exists (M1-fixed); no `virtual_office_id` column. Needed for /assistant fix (§3d) regardless of Tier-3 RLS. |
| `pending_notifications` | 🆕, low priority | Notifications are agency-operational, not usually per-office-restricted viewing; flag for a product decision rather than assuming Tier-3 needs it. |
| `virtual_office` itself | 🌐 (is the office) | Already correctly agency-scoped (M1-confirmed ✅); a Tier-3 user's own office row should be visible read-only — needs one additive SELECT clause, not a redesign. |
| `conversation_flows`/`flow_nodes`/`flow_options` | 🌐→ deferred | Stays global-by-design per M2; see §3c for how the *design* extends one level, not a claim that it's being fixed here. |
| `user_roles`, `profiles` | 🆕 (the mechanism itself) | No office column on either — this is §2's core design question. |
| Global catalogs (`care_types`, `care_service_categories`, `certifications`, `role_permissions`, `system_modules`, `system_roles`) | 🌐 | Unchanged from M1 — these are platform/agency-wide by design, not per-office. `agency_care_types` (M3, still unbuilt) is the per-*office* catalog-selection mechanism already designed for this exact reason — no new design needed here. |

---

## 2. Nested-Tenancy Role + Helper Design

> **Revised after review — the original §2 design failed OPEN on a NULL office for a
> Tier-3 user.** The fix below is not a patch on the original design, it replaces the
> ambiguous "NULL means unrestricted" signal with an explicit, DB-enforced marker so
> NULL can never again be read as "sees everything." Two-value change: what's stored,
> and what the helper/RLS clause check. The one-column/one-helper/one-additive-clause
> *shape* is unchanged.

### 2.1 The vulnerability, restated precisely

The original design used a single nullable column and read `NULL` as "this user is
unrestricted" (Tier 1/2). That's correct for an agency_admin, whose office really
should be unset. But it's indistinguishable, at the SQL level, from a Tier-3 manager
whose office was *never set* — e.g. by exactly the same class of bug this plan's own
"Root cause" section already proved happens (`create-user` "never touches
`virtual_office_id` at all," which is why 5/5 clients are NULL today). A future
version of `create-user` that sets `virtual_office_id` for staff would only need to
have that one write fail, be skipped, or race — and a brand-new branch manager
silently becomes agency-wide. This is the identical privilege-escalation shape M1
closed for `user_roles` (a NULL/mismatched scope column read as "no restriction"),
recurring one level down.

### 2.2 Fix: an explicit scope-tier marker, decoupled from the office value, enforced by a `CHECK` constraint

Rather than overloading NULL, add **two** columns whose relationship is guaranteed by
the database itself, not by application code remembering to set both:

```sql
ALTER TABLE public.profiles
  ADD COLUMN virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  ADD COLUMN office_restricted boolean NOT NULL DEFAULT false;

-- The invariant that makes this fail-closed, enforced at the database, not just in RLS:
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_office_restricted_requires_office
  CHECK (NOT office_restricted OR virtual_office_id IS NOT NULL);
```

`office_restricted = false` (the default) is the *only* way to be agency-wide — it is
never inferred from `virtual_office_id` being empty. `office_restricted = true` with
`virtual_office_id = NULL` is now a **database-rejected state**: the row cannot be
written that way at all, by any code path, including a future bug in `create-user` or
a direct SQL edit. This is option (b) from your list (a `CHECK` constraint) combined
with option (a) (a marker independent of the office value) — recommending both
together rather than choosing one, since they're complementary and cheap: (a) gives
the RLS logic something unambiguous to branch on, (b) makes the dangerous state
unrepresentable in the first place rather than merely handled correctly if it occurs.

Option (c) — enforcing it in the provisioning flow — is still adopted too, as the
first line of defense: `create-user`'s new office-handling code must set
`office_restricted` and `virtual_office_id` **together, in the same write**, for any
Tier-3 hire (the `CHECK` constraint makes "together" non-optional — a statement that
tries to set one without the other in the required combination is simply rejected).
This is genuinely three-layers-of-defense for one gap, not overkill: the same
discipline CLAUDE.md already asks for in the Tool Layer ("authentication → agency →
role/permission → parameters → action → audit") — code correctness is necessary but
not trusted alone for anything that gates access.

### 2.3 Helper functions

```sql
CREATE OR REPLACE FUNCTION public.current_virtual_office_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE WHEN office_restricted THEN virtual_office_id ELSE NULL END
  FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_office_restricted(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(office_restricted, false) FROM public.profiles WHERE id = _user_id
$$;
```

No separate `is_virtual_office_staff()` is needed — `is_agency_staff()` already
answers "does this user hold a staff-capable role," and office-narrowing is a pure
`WHERE` refinement on top of that, not a new capability check.

### 2.4 How the three tiers compose in ONE policy — now fail-closed

```sql
USING (
  has_role(auth.uid(), 'system_admin')
  OR (
    is_agency_staff(auth.uid())
    AND agency_id = current_agency_id()
    AND (
      NOT is_office_restricted(auth.uid())                    -- Tier 1/2: explicitly unrestricted, sees ALL offices
      OR virtual_office_id = current_virtual_office_id()       -- Tier 3: exact office match ONLY
    )
  )
)
```

Walk every real state through this:
- **Tier 1/2** (`office_restricted=false`, the only legitimate way to reach this
  state): `NOT is_office_restricted()` = true → unrestricted branch, unchanged from
  before.
- **Tier 3, correctly configured** (`office_restricted=true`, `virtual_office_id='X'`):
  falls to the second clause, `row.virtual_office_id = 'X'` — matches only that office.
- **Tier 3, office somehow NULL** — now **prevented from ever existing** by the
  `CHECK` constraint in §2.2. But even without relying on that: if it *did* exist,
  `current_virtual_office_id()` returns `NULL` (the `CASE` only returns the office
  when `office_restricted` is true, and here it's NULL despite that), so the row
  comparison becomes `row.virtual_office_id = NULL`, which is SQL's three-valued
  `UNKNOWN` — and RLS treats `UNKNOWN` as **excluded**, not included. The logic itself
  fails closed independent of the constraint. This is the key difference from the
  original design: there, `IS NULL` was used as a deliberate "match everything" signal;
  here, NULL can only ever produce a false/excluded comparison, never a true one.

This is still the M1 pattern (`is_agency_staff() AND agency_id=current_agency_id()`)
plus one additive `AND (...)` clause — no new mechanism, just a boolean-guarded
version of the same shape instead of an overloaded-NULL version.

### 2.5 What Tier-3 needs beyond RLS

- **`virtual_office` self-read**: add a 4th SELECT clause to `virtual_office`'s
  existing policies — `OR id = current_virtual_office_id()` — so a Tier-3 user can
  read (not manage) their own office's branding/settings row even though they aren't
  `is_agency_staff()`-unrestricted within it. *(Today they already pass
  `is_agency_staff()` for their capability role, so in practice this composes for free
  once §2.4's pattern is applied to `virtual_office` too — flagging only because
  `virtual_office`'s current policies use `is_agency_staff() AND agency_id=...` with
  no office branch yet, same gap as everywhere else.)*
- **`create-user` gains a `virtualOfficeId` parameter, and must set BOTH new columns
  together**: resolved server-side from the caller's own `profiles.virtual_office_id`
  (if the caller is Tier-3 — always use their own office, never client-supplied) or
  from an explicit selection (if the caller is Tier-2 managing multiple offices — the
  UI would need an office picker, Layer 2/M7 territory, not built here). When
  provisioning a Tier-3 hire, the function must set `office_restricted = true` and
  `virtual_office_id = <resolved office>` in the same `profiles` write — the `CHECK`
  constraint in §2.2 rejects the write outright if it ever tries to do one without the
  other, turning "the function forgot" into a hard error at creation time instead of a
  silent agency-wide grant discovered later.

---

## 3. The Five Coordinated Scoping Areas

### 3a. Operational data (`caregivers`/`clients`/`shifts`/`orders`)

**`caregivers`** — replace "Agency users can manage their caregivers":
```sql
DROP POLICY "Agency users can manage their caregivers" ON public.caregivers;
CREATE POLICY "Agency users can manage their caregivers"
ON public.caregivers FOR ALL TO authenticated
USING (
  agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid())
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (
  agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid())
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
);
```
**`clients`** — same additive clause on "Admins and managers can manage clients" and
"Staff can view clients." Both existing policies already have the `agency_id IN (...)`
shape; the office clause slots in identically.

**`shifts`/`shift_assignments`/`client_orders`/`time_entries`/`time_off_requests`** —
these need a **new `virtual_office_id` column** (🆕 in the map above) before any RLS
change is possible. Recommended pattern, `shifts` as the representative case:
```sql
ALTER TABLE public.shifts
  ADD COLUMN virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL;
-- Backfill (see §4) from client_id -> clients.virtual_office_id, since a shift's
-- office is the client's office (who is served), not necessarily the assigned
-- caregiver's — flagged explicitly as a product decision in §5, not assumed silently.

DROP POLICY "Agency staff manage shifts in their agency" ON public.shifts;
CREATE POLICY "Agency staff manage shifts in their agency"
ON public.shifts FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (same);
```
`shift_assignments`/`order_services` stay column-free, gaining a
`shift_assignment_virtual_office_id()`/`order_virtual_office_id()` helper mirroring
their existing `..._agency_id()` helpers exactly (same one-line `SELECT` pattern).

### 3b. Knowledge base — the actual contamination fix

Both retrieval RPCs need one new parameter and one new `WHERE` clause each — no
schema change, since `virtual_office_id` is already on `knowledge_documents` and
already correctly populated:

```sql
CREATE OR REPLACE FUNCTION public.match_agency_knowledge(
  _query_embedding vector, _language text, _limit integer DEFAULT 5,
  _match_threshold real DEFAULT 0, _agency_id uuid DEFAULT NULL::uuid,
  _surfaces text[] DEFAULT NULL::text[],
  _virtual_office_id uuid DEFAULT NULL::uuid   -- NEW
)
...
WHERE d.agency_id = COALESCE(_agency_id, public.my_agency_id())
  AND (_virtual_office_id IS NULL OR d.virtual_office_id = _virtual_office_id)  -- NEW
  AND d.is_active
  ...
```
Same change to `search_agency_knowledge`. Callers (`search-knowledge` Edge Function)
resolve `_virtual_office_id` server-side the same way they already resolve
`_agency_id` — from `PublicOffice.tsx`'s known office context for `/a/:slug`
visitors, `NULL` (agency-wide) for the authenticated caregiver-coach surface unless a
future per-office knowledge product need says otherwise. **This single change closes
the literal Ripple/Kind Care contamination** — passing `NULL` preserves today's
agency-wide behavior exactly, so it's a zero-risk default with an opt-in tightening.

### 3c. Flows — extending M2's design one level, not redoing it

M2 (still unbuilt) already designs `(audience, agency_id)` with a NULL-agency
fallback. Extending one level: `(audience, agency_id, virtual_office_id)` with the
**same fallback chain**, resolved in this order: office's own flow → agency's
flow (`virtual_office_id IS NULL`) → platform default (`agency_id IS NULL`). This is
additive to M2's design, not a redesign — M2 should be built with this in mind so the
column doesn't need retrofitting a second time, but **building it is still M2's scope,
not M-Office's**. Flagging the public-facing risk M2 already carries: any mistake here
breaks live screening/intake for every agency and office simultaneously — the
NULL-fallback chain needs exhaustive testing at each level, not just the top one.

### 3d. Intake attribution — closing the `/assistant` gap for real

`flow_session_submit_intake` gains the same fallback shape it already has for
`agency_id`, one level down:
```sql
-- After resolving v_agency_id (existing logic, unchanged):
IF p_virtual_office_id IS NULL THEN
  SELECT id INTO v_virtual_office_id FROM public.virtual_office
  WHERE agency_id = v_agency_id AND is_primary AND is_active
  LIMIT 1;
ELSE
  v_virtual_office_id := p_virtual_office_id;
END IF;
-- then use v_virtual_office_id (not p_virtual_office_id) in both INSERTs
```
This uses the **already-existing `is_primary` flag** on `virtual_office` as the
fallback target — no new fallback semantics invented, just reusing a column that's
already there for exactly this purpose. `caregiver_registrations`
(`ResultRegistration.tsx`) needs the equivalent: today it inserts `virtual_office_id`
directly from a prop with **no server-side fallback at all** (unlike the RPC's
agency-level one) — recommend moving this insert behind a small `SECURITY DEFINER`
RPC (mirroring `flow_session_submit_intake`'s pattern) so the same primary-office
fallback applies, rather than leaving it as the one remaining direct-insert path with
no fallback.

**`/a/:slug` needs no change** — `PublicOffice.tsx`/`get_public_office` already
resolve `virtual_office_id` unambiguously server-side from the slug (M8's discipline,
already followed here). Only the legacy `/assistant` route and its two submission
paths need the fallback added.

### 3e. Batch import (scoped to the manager's own office)

Design: a new Edge Function (e.g. `batch-import-caregivers`), modeled directly on
`create-user`'s proven shape — verify caller via `Authorization` header, resolve
`agency_id`/`virtual_office_id` **from the caller's own profile**, never from the
uploaded file. For a Tier-2 agency_admin (`virtual_office_id IS NULL`), require an
explicit office selection in the request (validated server-side against
`virtual_office.agency_id = caller's agency`, never trusted blind); for a Tier-3
manager, ignore any office field in the request and always use their own
`current_virtual_office_id()` — the same "never trust client-supplied tenant
identifier" discipline `search-knowledge` and `get_public_office` already established.
Parse rows, validate, call the same `auth.admin.createUser` + profile/role insert
sequence `create-user` already uses per row, collect per-row errors (partial success
allowed, matching how spreadsheet imports generally behave) rather than all-or-nothing.

**Separately, confirmed: `batch-create-users` should be deleted, not fixed.**
Verified this session: it has zero server-side auth check (doesn't read the
`Authorization` header at all despite `AdminUtilities.tsx` sending one), mass-deletes
every `auth.users` row project-wide except one hardcoded email, and recreates
everything under one hardcoded `agencyId` — fundamentally incompatible with more than
one agency existing, let alone offices. **Only one caller exists in the entire
codebase** (`AdminUtilities.tsx`'s "Batch Create Users" button, itself gated to
system_admin only client-side, which doesn't help since the function ignores auth
entirely). Nothing legitimate depends on it. Recommend deleting the function and its
button together, not "fixing" it — it's a demo-reset script, not a batch-import
feature, and the real batch-import need is what 3e designs instead.

---

## 4. Backfill Plan — verified against live data, not assumed

Checked each flagged row individually rather than bulk-assuming Ripple. Evidence:
`virtual_office.service_states`/`service_zipcodes` are already populated and
distinct per office — Kind Care serves **IL** zips (`60093, 60025, 60026, 60091,
60201, 60062` — Chicago North Shore), Ripple Effects serves **MI** (state-level, no
zip list). Kind Care is also `is_active=false` (confirmed in §"Root cause") — no
current real operational data is intended for it. Cross-referencing:

1. **`clients`** (5/5 NULL) — all 5 are in Michigan (`Kalamazoo 49001`,
   `Portage 49024`, `Comstock 49041`, `Texas Township 49009`, `Kalamazoo 49008`),
   squarely in Ripple's MI service area and nowhere near Kind Care's IL zips.
   4 of the 5 share an identical `created_at` timestamp with the 5 demo caregivers
   `attach_demo_caregivers_to_ripple_office.sql` already backfilled to Ripple —
   same seed batch that migration's own comment says was caught for caregivers but,
   per this evidence, was missed for clients. The 5th (`Eleanor Whitfield`,
   `is_demo=false`, Kalamazoo MI) is a separately-created real test record, still MI.
   **Confirmed: all 5 → Ripple Effects (`12faa863-017e-438c-966c-f67be9b726e7`).**
2. **`caregivers`** (1/6 NULL) — `Dana Reyes`, `is_demo=false`, created
   `2026-09-09T13:04` — the exact caregiver named in the still-open
   `AvailableShifts` known-issue, created ~5 hours after the `Eleanor Whitfield`
   client above on the same day, both non-demo, both office-less. No conflicting
   evidence found (Kind Care has zero real records of any kind in the current
   dataset). **Confirmed: → Ripple Effects,** consistent with every other real
   record in the system.
3. **`families`** (1/3 NULL) — `Tomas Edison family`, `is_demo=false`. The other two
   families (`David Robinson family`, `George family`) are already correctly set to
   Ripple. **Confirmed: → Ripple Effects,** same pattern.
4. **`shifts`/`client_orders`/`time_entries`/`time_off_requests`** (once columns are
   added per §3a): backfill via their existing `client_id`/`caregiver_id` join to the
   now-corrected `clients`/`caregivers.virtual_office_id`, so steps 1–3 must run
   *before* this backfill, not after.
5. **`events`** (47/52 NULL): lowest priority — recommend leaving historical NULL
   rows as-is (an audit log backfill has no real product value) and just ensuring new
   events get `virtual_office_id` populated going forward once the writing code paths
   are updated.

**Net result: every currently-NULL operational row (clients, caregivers, families)
backfills to Ripple Effects, verified by geography and seed-batch correlation, not
assumed.** No row needs the "Primary Office" or Kind Care as its target — Kind Care
has zero real records under it today.

---

## 5. Two-Office Isolation Test (the done-definition)

Same discipline as M1's two-tenant test — real accounts, real JWTs, real RLS through
PostgREST, disposable fixtures, teardown verified by re-querying, not by trusting
delete responses.

1. **Provision two disposable offices under the same real Agency A** (`56fbfe38`) —
   not the real Kind Care/Ripple/Primary Office rows, to avoid touching live demo
   data. Bootstrap one throwaway Tier-3 manager per office
   (`office_restricted=true`, `virtual_office_id` set to their respective office),
   one throwaway Tier-2 agency_admin (`office_restricted=false`, `virtual_office_id`
   NULL — the *legitimate* NULL case), reuse the pattern for a throwaway system_admin.
   **Also attempt to directly construct the dangerous state** (`office_restricted=true`,
   `virtual_office_id=NULL`) via a raw service-role write, both as an `INSERT` and as
   an `UPDATE` that flips `office_restricted` to `true` on a row whose office is
   already NULL — **both must be rejected by the `CHECK` constraint**. This is the
   actual fail-closed proof: if the dangerous state can never be written in the first
   place, there is no live row for a fail-open RLS read to ever apply to. If either
   write unexpectedly succeeds, that's a finding, not a passed precondition, and the
   rest of the test should still proceed to confirm what that leaked row could see
   (defense-in-depth check on the RLS clause itself).
2. **Fixture rows**: one disposable caregiver/client/shift (once `shifts` has the
   column) per office, one disposable `knowledge_documents`/chunk per office (to prove
   3b's fix).
3. **Isolation (Office A manager targeting Office B data, same agency)**:
   - Cannot SELECT Office B's caregiver/client/shift rows.
   - Cannot UPDATE Office B's rows (confirm via service-role recheck, not just the
     response).
   - Knowledge query scoped to Office A's `virtual_office_id` returns zero hits for
     an Office-B-only marker phrase (proves 3b).
4. **Regression — Tier-2 must still see both**: the throwaway agency_admin
   (`virtual_office_id IS NULL`) reads/writes both offices' fixture rows successfully
   — proves the `IS NULL` branch in §2.3's composed policy actually grants the
   agency-wide view, not just that Tier-3 is blocked.
5. **Regression — the live Ripple demo must keep working**: as a real (or
   equivalently-scoped throwaway) Ripple-office-scoped account, confirm Ripple's own
   caregivers/clients/knowledge remain fully visible and unaffected — the same
   "frozen-demo discipline" check M1 ran for Kind Care.
6. **system_admin bypass**: unaffected, sees across offices and agencies as before.
7. **Teardown**: delete every fixture row/office/user, then re-query each to confirm
   absence — identical discipline to M1's §7.3.

Only once this passes is M-Office's core mechanism considered proven — UI work for
the three-tier panels (M6/M7) should not start before this, same lesson M1 already
taught for agency-level isolation.

---

## 6. Decisions — resolved

1. **A shift's office: client-side.** Confirmed — `shifts.virtual_office_id`
   backfills from `client_id → clients.virtual_office_id` (§3a), matching "an office
   serves a set of clients; caregivers are staffed to it."
2. **`clients` backfill target: Ripple Effects, verified** (§4) — confirmed against
   live geography (all 5 in Michigan, matching Ripple's MI service area and nowhere
   near Kind Care's IL zips) and seed-batch correlation, not assumed.
3. **Secondary tables** (`pending_notifications`/`earnings_lines`/`shift_ratings`/
   `events`): **agency-wide for now, office-scope the operational core only.**
   Confirmed — no Tier-3 office-scoping added to these in this pass; revisit only if
   a real product need appears later.
4. **`caregiver_registrations`'s `ResultRegistration.tsx` insert path** (§3d): folded
   into this plan as a real (small) code change — moving the insert behind a new
   `SECURITY DEFINER` RPC mirroring `flow_session_submit_intake`'s fallback pattern,
   not a data-only fix.

**Also approved: delete `batch-create-users` and its `AdminUtilities.tsx` button
together.** Confirmed this session: the function has zero server-side auth check
despite the button's client-side system_admin gate, only one caller exists in the
whole codebase, and it mass-deletes every `auth.users` row project-wide under a
single hardcoded `agencyId` — structurally incompatible with more than one agency or
office existing. No legitimate dependency found.

## 7. What This Plan Deliberately Does Not Do

Apply any schema/RLS/RPC/data change. Build M2's `conversation_flows` per-office index
(that remains M2's own scoped phase — §3c only extends its *design*, doesn't schedule
its build here). Build the Tier 1/2/3 UI panels (M6/M7 territory, explicitly gated on
this plan's mechanism being proven first, same as M1 gated M6/M7). Touch any table
already confirmed agency-correct in M1 beyond adding the office-composition clause
designed here.

**Status: CLOSED — applied and verified 2026-09-14.** §8 records the closure.

---

## 8. Closure Record (2026-09-14)

### 8.1 Migrations applied (three, in sequence — see 8.2 for why)
1. `supabase/migrations/20260914005540_m_office_scoping.sql` — the reviewed §2-§4
   design: `profiles.virtual_office_id`/`office_restricted`/the `CHECK` constraint,
   the two helpers, RLS on all 7 tables listed in §1, the knowledge RPC office filter,
   `flow_session_submit_intake`'s office fallback, the new `submit_caregiver_registration`
   RPC, and the verified backfill (§4). First push attempt failed cleanly (transactional
   rollback, confirmed via direct re-query before any fix was attempted) on
   `type vector does not exist` — the pgvector extension lives in the `extensions`
   schema on this project, and an unqualified `vector` parameter type only resolves
   under a session whose `search_path` includes it, which `supabase db push`'s session
   does not. Fixed by qualifying as `extensions.vector`; re-pushed successfully.
2. `supabase/migrations/20260914012746_m_office_drop_stale_knowledge_overloads.sql` —
   fix-up, applied immediately after discovering (before any testing) that
   `CREATE OR REPLACE FUNCTION` does not replace a function when a parameter is added —
   it creates a second overload. This left `match_agency_knowledge` and
   `search_agency_knowledge` each with two live versions, and — the more serious part —
   the new overloads did not inherit the old ones' `REVOKE` from Tranche 3A
   (`20260905090000_establish_surface_boundary.sql`), so they carried default
   `EXECUTE` grants to `anon`/`authenticated`. Confirmed live via `aclexplode(proacl)`
   before writing the fix. Dropped the stale overloads and re-applied the identical
   `REVOKE ALL ... FROM PUBLIC, anon, authenticated` Tranche 3A used. Fixed and pushed
   the same session, before any isolation testing began — the exposure window was the
   time between the first migration landing and this one, during which no anonymous
   traffic is known to have hit either function directly (the only public caller,
   `search-knowledge`, continued routing through its own auth path throughout).
3. `supabase/migrations/20260914013129_m_office_drop_stale_match_agency_knowledge.sql` —
   second fix-up: migration #2's `DROP FUNCTION` for `match_agency_knowledge`
   silently no-op'd (no error) because its matching logic compared
   `pg_get_function_identity_arguments(oid)` against a hardcoded string assuming
   unqualified `vector` — but that function renders the type name qualified or
   unqualified depending on the *calling session's* `search_path`, so under
   `db push`'s session it never matched (this is the same root mechanism as fix #1,
   surfacing a second time). `search_agency_knowledge`'s drop in the same migration
   worked because its signature has no vector-typed parameter to be affected. Fixed
   by matching on argument count (`pronargs = 6`) instead of any type-name string,
   which is `search_path`-independent. Re-verified via `pg_get_function_identity_arguments`
   and `aclexplode` after each push — confirmed exactly one overload per function,
   correctly grant-locked, before any testing began.

**All three issues were caught and fixed by direct verification before the isolation
test ran, not discovered by the test itself** — consistent with this project's
"prove absence by content, not by a call returning `ok`" discipline (Tranche 3E
precedent).

### 8.2 Deployment
`supabase functions delete batch-create-users` (confirmed `ACTIVE` before deletion,
confirmed gone from `supabase functions list` after — approved in the prior turn).
`supabase functions deploy search-knowledge` and `create-user` (the two Edge Functions
with code changes). The five frontend-only file changes
(`KnowledgeQaSurface.tsx`/`PublicOffice.tsx`/`ResultRegistration.tsx`/
`CaregiverRegistration.tsx`/`AdminUtilities.tsx`) are committed to the working tree,
type-checked clean, but **not deployed** — that goes through this project's normal
frontend build/deploy path, outside this session's access. Until that redeploy
happens, the live public pages keep running their pre-change code (agency-wide
knowledge retrieval, the old direct-insert registration paths) — functionally
unchanged from before this phase, not broken, just not yet carrying the fix to
production traffic.

### 8.3 Two-office isolation test — 22/22 passed

Same method as M1 (real `auth.admin.createUser` accounts, real `signInWithPassword`
JWTs, real RLS through PostgREST). Two disposable offices under the real Agency A
(`56fbfe38`) — not the real Kind Care/Ripple/Primary Office rows.

**A. Fail-open rejection (3/3):**
| Check | Result |
|---|---|
| `UPDATE office_restricted=true` + NULL office | rejected — `profiles_office_restricted_requires_office` |
| `UPDATE` clearing office while still restricted | rejected — same constraint |
| Profile genuinely unchanged after the rejected write | confirmed via re-read |

**B. Isolation, Office Alpha manager → Office Beta data (6/6):**
cannot `SELECT` Beta caregiver/client; *can* `SELECT` own-office caregiver (sanity);
cannot `UPDATE` Beta caregiver/client (service-role rechecked, not just the response);
cannot call `match_agency_knowledge` directly at all (`permission denied` — proves the
3A `EXECUTE` revocation survived this phase's RPC signature change).

**B2. Knowledge office filter, service-role level (2/2):** office=Alpha finds Alpha
content, not Beta; office=NULL finds both (agency-wide default preserved exactly).

**C. Three-path attribution, `submit_caregiver_registration` (4/4):**
| Path | Result |
|---|---|
| `/a/:slug`-equivalent (explicit agency+office) | **preserved**, not overridden — `virtual_office_id` = the explicit Ripple id passed in |
| `/assistant`-equivalent (both null) | falls back to real agency + its primary office |
| `/caregiver-registration`-equivalent (both null) | same fallback — the new finding, now covered |
| `flow_session_submit_intake` office fallback | populates `virtual_office_id` on the created family/care_request |

**D. Regression, Tier-2 agency_admin (2/2):** sees both offices' caregivers and clients
— proves the `NOT is_office_restricted()` branch grants the intended agency-wide view,
not just that Tier-3 is blocked.

**E. Regression, live Ripple demo (3/3):** the *deployed* `search-knowledge` function
answers for real Agency A both with and without the new `virtual_office_id` parameter
(near-identical `top_similarity` in both calls — 0.260743 vs 0.260675 — confirming the
office parameter didn't disrupt existing retrieval); Tier-2 staff access to real
knowledge_documents intact.

**F. system_admin bypass (2/2):** sees both offices' caregivers and both office rows.

**Teardown:** every fixture row, test office, and throwaway user deleted, then
re-queried (not just trusting delete responses) — all confirmed absent. Local test
scripts and the `pg`/`@supabase/supabase-js` npm packages were `--no-save`; `git
status` confirmed clean of anything but the intended migration/code files throughout.

### 8.4 Explicitly not covered by this test (by design, matching §1's deferred scope)
`shifts`/`shift_assignments`/`client_orders`/`time_entries`/`time_off_requests` —
no `virtual_office_id` column exists on these yet (§1, §7 of the earlier plan text),
so no isolation claim is made for them here. Any future phase adding those columns
needs its own isolation test before being considered proven, following this same
discipline.
