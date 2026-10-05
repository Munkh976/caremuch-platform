# Known Issues

## `shift_trades` RLS is agency-wide, not office-scoped

**Status:** Found 2026-09-16 while designing the caregiver Available Shifts redesign
(`docs/scheduling-caregiver-board-plan.md` §0.5). Not fixed as part of that redesign --
the redesign's own `get_caregiver_trade_shifts()` function office-scopes itself
explicitly rather than trusting this looser RLS, so the caregiver-facing feature isn't
exposed to this gap. The underlying table policy itself is still loose.

`shift_trades` has no `virtual_office_id` column, unlike `shifts`/`clients`/`caregivers`/
etc. after Phase 0/M-Office. Its RLS policies (`"Agency staff can view/manage shift
trades"`) scope by agency only, via a join through `original_caregiver_id`'s agency --
any authenticated user in the same agency (not just staff, and not office-restricted)
can read or update any trade row, including one whose original caregiver is in a
different office. This is the same class of gap M1/M-Office/Phase 0 closed for other
scheduling tables, just never applied to this one.

**Deliberately out of scope for now** -- logged as its own smaller follow-up. Fixing it
properly would need a `virtual_office_id` column on `shift_trades` (or a derived one via
the joined shift) plus updated RLS policies, mirroring the established pattern.

**Re-confirmed 2026-10-04 by the S-OFF-1 sweep** (see "RESOLVED (part): S-OFF-1" below). The staff
INSERT and UPDATE policies ("Agency staff and caregivers can create shift trades", "Agency staff can
manage shift trades") are still agency-only. An office-restricted manager can create or decide a
trade of another office through direct table writes. Still open: it needs the column/policy change
above plus the RLS write-path audit, not a one-line guard.

## RESOLVED: a real caregiver account could never complete a trade-board pickup

**Status:** Found 2026-09-16 by the caregiver Available Shifts redesign's own test, before
ship (`docs/scheduling-caregiver-board-plan.md` §9.1). Fixed same-day via
`20260916210000_caregiver_pickup_trade_shift.sql`.

`assign_caregiver_to_shift()` (used by the trade-pickup flow) starts with
`IF NOT public.is_agency_staff(auth.uid()) THEN RAISE EXCEPTION 'Only agency staff can
assign shifts'`. `is_agency_staff()` only recognizes `system_admin`/`agency_admin`/
`manager`/`scheduler`/`hr_staff` -- `caregiver` has never been in that list. This means a
genuine caregiver account clicking "Pick up" on a Trade Board item has never actually
worked, in either the pre-existing `ShiftTrades.tsx` page or the new Trade Shifts section
-- it would always hit "Only agency staff can assign shifts". Moot for `ShiftTrades.tsx`
specifically now that caregivers are routed away from that page (the new route guard), but
the underlying gap was real and had gone unnoticed, presumably because that page was only
ever tested by staff/admin accounts.

**Fix:** a dedicated `caregiver_pickup_trade_shift(_trade_id)` RPC, self-scoped from
`auth.uid()`, mirroring `caregiver_pick_up_shift()`'s existing pattern rather than relaxing
`assign_caregiver_to_shift()`'s staff-only auth surface (a deliberate choice to keep that
function's authorization boundary untouched). Includes a claim-then-act race guard
(`UPDATE shift_trades ... WHERE status='pending'` before touching `shift_assignments`),
verified live with a genuine two-connection concurrent-claim test: exactly one caller wins,
the loser gets a clean rejection, no duplicate/corrupted assignment rows.

## FUTURE FEATURE: caregiver-initiated "give up my shift" flow

**Status:** Logged 2026-09-16 while designing the caregiver Available Shifts redesign.
Not built, not started.

Today, `shift_trades` rows are only ever created by staff-side automation
(`TimeOffDecisionDialog.tsx`, when a manager approves a caregiver's time-off request and
that caregiver's now-conflicting shifts are dropped onto the trade board). There is no
caregiver-facing UI anywhere to voluntarily give up an assigned shift outside of that
flow, despite `role_permissions` granting the `caregiver` role `can_create` on
`shift_trades` (a grant that currently has no UI wired to it).

**Deliberately out of scope for now** -- a legitimate future feature, not part of the
Available Shifts redesign (which only changes how a caregiver *browses and picks up*
what already exists).

## RESOLVED: caregivers had zero RLS access to `clients` -- "Unknown client" everywhere, and a compounding AvailableShifts regression

**Status:** Found 2026-09-16 investigating a user-reported "Unknown client" bug on a shift
detail view. Diagnosed as a pure LOGIC gap, not a data problem -- a full chain-consistency
audit of the demo agency (56fbfe38: 5 clients, 8 orders, 31 shifts, 17 assignments, 6
caregivers) found **zero** orphaned FKs, zero NULL offices, zero office mismatches anywhere.
Fixed via `20260916120000_caregiver_visible_client_info.sql`, committed separately
(`0898363`) from the Available Shifts redesign. Verified live: 19/19 checks, teardown
confirmed by re-query.

**Root cause:** `public.clients`' RLS policies -- unchanged since they were first created
(`20251103220124`, 2025-11-03), predating M1/M-Office/Phase 0/Phase 1B entirely -- only ever
covered staff roles (system_admin/agency_admin/manager/scheduler/hr_staff) and a client's own
login (`user_id = auth.uid()`). **No policy ever granted a caregiver `SELECT` on any `clients`
row**, not even the client on their own assigned shift. A caregiver-facing nested PostgREST
embed (`shifts -> clients`, used by `CaregiverDashboard.tsx` and `AvailableShifts.tsx`)
silently resolves the embedded relation to `null` when RLS denies it, rather than erroring --
so `ShiftDetailsDialog.tsx` rendered its own "Unknown client" fallback string. Interestingly
the reverse direction was built (`Clients view caregivers (agency scope)`) but the caregiver-
side equivalent apparently never was.

**Compounding discovery, worse than the reported symptom:** `AvailableShifts.tsx` filters
`if (!shift.clients) return false` before rendering -- meaning this same gap made **every**
open shift disappear from the caregiver's "Available Shifts" list entirely, not just show
"Unknown client". This recreates the exact "0 shifts available" symptom this doc's own
now-superseded "Caregivers cannot see open/unassigned shifts" entry described, via a
*different* mechanism than the one Phase 1B fixed. **Phase 1B's own E-test only verified the
raw `shifts`-table RLS policy at the SQL level and did not exercise `AvailableShifts.tsx`'s
actual client-side filter logic, so it did not catch this** -- worth remembering for future
phases: a passing SQL-level RLS check does not guarantee the page that depends on it renders
correctly when a *different* table's RLS blocks a value the page's own client-side logic
treats as required.

**Why a full-row RLS policy was rejected as the fix:** `clients` carries
`medical_conditions`/`care_requirements`/`notes` (PHI-adjacent free text). This project
already established the principle that these fields must not reach a caregiver-facing surface
(`match-caregiver` excludes them from matching for privacy/safety/legal reasons, see
CLAUDE.md's AI provider strategy section) -- the same principle applies to caregiver
client-*visibility*, not just matching. A full-row policy would have fixed the symptom while
reopening exactly the exposure that principle exists to prevent.

**Why column-level `GRANT` doesn't work here:** every application-level role (caregiver,
manager, agency_admin, ...) maps to the same Postgres role, `authenticated`, in this project --
authorization is done entirely via RLS policies referencing `auth.uid()`/helper functions, not
via distinct database roles per application role. A column-level `GRANT`/`REVOKE` on
`authenticated` would affect staff too, breaking their legitimate access to the same columns.

**The fix:** a new `SECURITY DEFINER` function, `get_caregiver_visible_clients()`, does its own
row-filtering (a shift the caller is assigned to, OR an open shift in the caller's own office
-- mirroring the Phase 1B `AvailableShifts` RLS policy's own scoping shape) and returns ONLY a
narrow, non-PHI column list: `first_name`, `last_name`, `phone`, `address`, `city`, `state`,
`zip_code`, `scheduling_flexibility` (a controlled enum -- `continuity`/`balanced`/`flexible`,
see `src/lib/flexibility.ts` -- confirmed NOT free text before including it). Excluded:
`email`, `date_of_birth`, `emergency_contact_*`, `care_requirements`, `medical_conditions`,
`notes`, `scheduling_notes`, `preferred_caregiver_id`, `family_id`, and all internal/audit
columns. The base `clients` table's RLS/grants are completely untouched, so staff access is
unaffected by construction. `CaregiverDashboard.tsx` and `AvailableShifts.tsx` now fetch this
narrow client map separately (`src/lib/caregiverVisibleClients.ts`) and merge it onto shifts
client-side instead of embedding `clients` in the PostgREST query.

**Phone refinement:** a client's phone number is still returned by the RPC regardless of
connection reason (assigned vs. browsable-open), but `ShiftDetailsDialog.tsx` only *displays*
it when the shift is not `open`/`unassigned` -- a caregiver previewing an open shift they
haven't picked up yet sees name/location but not phone; picking it up (or viewing an assigned
shift) shows it. Deliberately a display-layer gate, not an RPC change -- phone was judged
low-risk enough not to warrant denormalizing the RPC by connection-reason.

## Systemic date-only-string parsing bug: `new Date(dateOnlyString)` renders the wrong calendar day west of UTC

**Status:** Found 2026-09-16 alongside the "Unknown client" investigation (the reported shift
displayed "Sept 15" for a row whose actual `shift_date` is `2026-09-16`). Confirmed systemic,
NOT fixed in this pass -- more than the "if trivial" one-liner it first looked like.

**The mechanism:** a `date`-typed Postgres column comes back from Supabase as a bare
`"YYYY-MM-DD"` string. Per the ECMAScript spec, `new Date("2026-09-16")` (no time component)
parses as **UTC midnight**, not local midnight. `.toLocaleDateString()`/`.toLocaleString()`
then renders that instant in the *browser's local timezone* -- anywhere west of UTC (all of the
US, for instance), this rolls back to the previous calendar day. Appending a bare time
component without a zone offset avoids this: `new Date("2026-09-16T00:00:00")` (no trailing
`Z`) is parsed as **local** midnight per spec, which is why some call sites already display
correctly by accident.

**Confirmed present (renders one day early) in:** `src/components/schedule/ShiftDetailsDialog.tsx:78`,
`src/pages/AvailableShifts.tsx:221`, `src/components/caregivers/ShiftList.tsx:99`,
`src/components/client-dashboard/CareHistory.tsx:137`, `src/pages/Dashboard.tsx:513`,
`src/components/schedule/ShiftCard.tsx:71`, `src/components/dashboard/UpcomingShifts.tsx:121`,
`src/components/client-dashboard/MySchedule.tsx` (multiple), plus several `shift_date`-only
comparisons in `CaregiverDashboard.tsx` (upcoming/this-week/history filtering -- these can
misclassify a shift by a day at week/day boundaries, not just display it wrong).

**Confirmed already correct (appends `T00:00:00` or otherwise avoids the bug):**
`src/components/orders/OrderWizardDialog.tsx:486`, `src/pages/Reports.tsx:187`,
`src/lib/shiftEligibility.ts` (`v_dow`/`v_hours_until` calculations).

**Deliberately not fixed here** -- this touches ~10 files, not one, and several of the broken
sites are date-*comparison* logic (which shift bucket a shift falls into), not just display
formatting, so a blanket fix deserves its own scoped pass with real before/after verification
across timezones, not a rushed edit folded into an unrelated PHI-visibility fix. The clean fix
is almost certainly a single shared helper (e.g. `parseShiftDate(dateOnlyString)` using
date-fns's `parseISO`, which already treats a date-only string as local midnight) used
everywhere `shift_date` is turned into a `Date`, replacing the ad hoc `new Date(...)` calls one
by one.

## New scheduling rows (shifts/client_orders/time_entries/time_off_requests) land with NULL virtual_office_id

**Status:** Found 2026-09-14 while testing Smart Scheduling Phase 0 (see
`docs/scheduling-phase0-plan.md` §7.3). Confirmed empirically, not fixed — deliberately
deferred to Phase 1A's audit rather than patched blind.

Phase 0 added `virtual_office_id` to `shifts`/`client_orders`/`time_entries`/
`time_off_requests` and backfilled every row that existed at migration time (0 NULL
remaining, verified). But it added no trigger or other mechanism to populate the
column on a row inserted *after* the migration — proven by inserting throwaway rows
without setting it explicitly and observing `NULL` come back, in all three tables
tested. This is the same class of gap M-Office found and fixed for `create-user`
(which "never touche[d] `virtual_office_id` at all," the direct cause of the
`clients`/`caregivers` "unassigned office" symptom) — except here the actual
write path (wherever the scheduling UI creates these rows today) hasn't been
identified yet; that's explicitly Phase 1A's job.

**Consequence:** not a security gap — the fail-closed office RLS design means a NULL
office is invisible only to Tier-3 (office-restricted) managers, never over-exposed.
It's an availability/workflow gap: new shifts/orders/time-entries/time-off created
after this migration won't be visible to the office manager who should own them,
until Phase 1A's audit identifies the real write paths and fixes them (or a
deliberate interim trigger is added, if that's preferred before Phase 1A lands).

**Deliberately not fixed here** — tracked so Phase 1A treats this as an expected,
already-known finding rather than rediscovering it.



## FOOTGUN: `LANGUAGE sql` function bodies are validated at `CREATE` time, not `plpgsql`

**Status:** Hit once (Smart Scheduling Phase 0, 2026-09-14), caught by the first
migration push failing cleanly (transactional rollback, confirmed via direct
re-query) rather than silently — filed here so the next `LANGUAGE sql` function
doesn't need to rediscover it the hard way.

**The mechanism:** a `plpgsql` function body is only *parsed* for syntax at `CREATE`
time — table/column references inside it aren't resolved until the function actually
runs, so it's fine to `CREATE` one that references a column that doesn't exist yet, as
long as the column exists by the time the function is *called*. A `LANGUAGE sql`
function body has no such deferral — Postgres validates every table/column reference
in it **at `CREATE FUNCTION` time**, exactly like a plain view or query. Referencing a
column that doesn't exist *yet* in the migration (even if a later statement in the
same file adds it) fails the `CREATE FUNCTION` statement immediately.

**Concretely, what happened:** `shift_assignment_virtual_office_id()` (`LANGUAGE sql`,
mirroring the existing `shift_assignment_agency_id()` pattern) was originally placed
*before* the `ALTER TABLE shifts ADD COLUMN virtual_office_id` statement it selects
from, in the same migration. `supabase db push` failed immediately with `column
"virtual_office_id" does not exist` — not a silent no-op, a hard stop, cleanly rolled
back. Fixed by moving the `ALTER TABLE` earlier than the function definition.

**The rule going forward:** when a migration adds both a new column and a `LANGUAGE
sql` helper that reads it (the established pattern for all the `..._agency_id()`/
`..._virtual_office_id()` one-line lookup helpers in this codebase), the `ALTER TABLE
ADD COLUMN` must come **before** the `CREATE FUNCTION` in file order, not just before
the function is ever called. This doesn't apply to `plpgsql` functions — only `sql`.
Relevant for Phase 1B's eligibility engine if any of its planned helpers are written
as `LANGUAGE sql`.

## FOOTGUN: `CREATE OR REPLACE FUNCTION` does not replace when you add a parameter — creates a second overload with default grants

**Status:** Hit twice in one session (M-Office, 2026-09-14) before being filed here.
Not a one-off mistake — a genuine Postgres footgun worth checking for on every future
migration that changes an RPC signature.

**The mechanism:** `CREATE OR REPLACE FUNCTION` only replaces a function whose
argument **types** (in order) exactly match an existing one. Adding a new trailing
parameter — even with a `DEFAULT` — changes the signature, so Postgres creates a
**second, separate function object** (new `oid`) alongside the original rather than
replacing it. This produces two distinct problems, not one:

1. **Stale overload lingers**, silently changing which version a given call resolves
   to depending on whether it passes the new parameter — the "fixed" behavior may not
   apply to every caller, and nothing errors to tell you.
2. **The new overload does not inherit the old one's grants.** If the old function had
   `anon`/`authenticated` `EXECUTE` explicitly `REVOKE`d (as `match_agency_knowledge`/
   `search_agency_knowledge` did, from Tranche 3A), the new overload gets Postgres's
   **default** grants instead — which include `EXECUTE` for `PUBLIC` unless the
   database's default privileges say otherwise. On this project that meant a security
   regression: anon/authenticated could suddenly call the knowledge RPCs directly
   again, the exact bypass Tranche 3A closed. This is the more dangerous half — #1 is
   a correctness bug, #2 is a silently-reopened access-control hole.

**Confirmed** via `SELECT p.oid, pg_get_function_identity_arguments(p.oid), acl.grantee, acl.privilege_type FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl WHERE p.proname = '...'` — this is the check to run after *any* migration that changes an RPC signature, not just when something looks wrong.

**A second trap layered on top of the first:** identifying the stale overload to drop
by matching a hardcoded type-name string (e.g. comparing
`pg_get_function_identity_arguments(oid)` against a literal containing `vector`)
is itself unreliable — that function renders extension types (like pgvector's
`vector`) schema-qualified or not **depending on the calling session's own
`search_path`**, which differs between an interactive session and `supabase db push`'s
session. A string match that works when you test it manually can silently no-op (no
error — just doesn't find a match) when run through the actual migration tool. Match
on **`pronargs`** (argument count) instead, or another `search_path`-independent
signal — never a rendered type-name string.

**The rule going forward:** any migration that changes an RPC's parameter list must,
in the same migration:
1. Explicitly `DROP FUNCTION` the old signature (matched by `pronargs` or another
   `search_path`-independent identifier, never a rendered type-name string) —
   `CREATE OR REPLACE` is not sufficient on its own.
2. Re-apply any `REVOKE`/`GRANT` the old function had, since the surviving function is
   a new object with fresh default privileges.
3. Verify with the `aclexplode` query above before considering the migration done —
   not just "it applied without error."



## RESOLVED: Caregivers cannot see open/unassigned shifts (`AvailableShifts` returns 0 rows)

**Resolved:** closed by Smart Scheduling Phase 1B (`20260915215024`: "Caregivers read their own
assigned shifts" + "Caregivers view open shifts in their office"; product decision: all open shifts
in the caregiver's own office). Confirmed and kept unchanged by the October 2026 security batch.
The residual (the whole row, including notes, is visible) is the `special_notes` entry below.

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

**Updated 2026-09-15, Smart Scheduling Phase 1B:** `check_assignment_eligibility`'s
Rule J (service area) was promoted from advisory to **soft** (overridable with a
manager note) in Phase 1B, but using the *existing* zip-list/boolean check only — no
distance math was added. The originally-scoped "hard block over 20mi / soft under
20mi" real-distance threshold was explicitly deferred to Phase 2, on the reasoning
that the ranking layer below needs a real zip-centroid+haversine distance calculation
too (closer caregivers should rank higher) — building it once, for both the Rule J
hard threshold and ranking, is the plan. Do not lose this 20-mile hard-threshold
requirement when Phase 2 designs the real distance infrastructure — it was a locked
scope item for Phase 1B's own plan (`docs/scheduling-phase1b-plan.md` §0), only its
implementation was pushed out, not the requirement itself.

**Also flagged 2026-09-15, tracked as its own Phase 2 design item, not yet
researched:** the service-area *model* itself is still an open question, separate
from the distance-threshold question above — is service area a radius from a
caregiver's home address/city (`service_radius_miles`), an explicit zip list
(`service_zipcodes`, today's mechanism), a caregiver picking from the agency's own
structured service-area cities (bounded, not free-text), or some combination (e.g.
declared cities AND a radius as a secondary factor)? This is linked to the same
distance-infrastructure decision above (zip-centroid + haversine, or real geocoding)
since ranking wants real distance regardless of which service-area model is chosen.
Research the options and recommend during Phase 2 — not decided or started yet.

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

## RESOLVED: SECURITY: batch-create-users looks like unsafe leftover dev tooling

**Status:** Found while auditing user-provisioning paths for the `my_agency_id()`
isolation invariant (2026-09-02). **Deleted outright 2026-09-14** as part of
M-Office (see `docs/m-office-scoping-plan.md` §3e/§7) — confirmed exactly one caller
in the whole codebase (`AdminUtilities.tsx`'s button, itself only client-side-gated,
which never helped since the function ignored auth entirely), removed the Edge
Function (`supabase functions delete`) and the button/handler together. The real
batch-import need this was never actually a safe implementation of is designed fresh
in the M-Office plan §3e, not built in this pass.

**Original finding, kept for history:**

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

## RESOLVED: AddUser.tsx leaves new staff with profiles.agency_id = NULL

**Status:** Found 2026-09-02. **Resolved 2026-09-09**, alongside investigating a live bug
report (a new system user, `will.fitzgerald@gmail.com`, appeared in the list but couldn't
log in — "waiting for confirmation" — then a retry threw `insert or update on user_roles
violates FK user_roles_user_id_fkey`).

**Original symptom:** `src/pages/AddUser.tsx` created staff accounts via a direct
client-side `supabase.auth.signUp()` call, passing only `full_name` in the signup
metadata — never `agency_id`. The `user_roles` insert that followed also omitted
`agency_id`. Since `handle_new_user()` only sets `profiles.agency_id` from
`raw_user_meta_data->>'agency_id'` (defaulting to `NULL` when absent), any staff member
created through this page ended up with `profiles.agency_id = NULL`, breaking
`current_agency_id()` (and therefore `my_agency_id()`) for that account.

**Root cause turned out to be one thing, not two:** `AddUser.tsx`'s `signUp()` is a
fundamentally different account-creation mechanism than every other one in the app
(`create-user`, `enable-client-login`, `enable-caregiver-login`,
`approve-caregiver-registration`), all of which use the Admin API
(`auth.admin.createUser({..., email_confirm: true})`). The client-side `signUp()` path:
(a) respects the project's `mailer_autoconfirm: false` setting, requiring email
confirmation before login — the literal cause of "waiting for confirmation" — and (b) had
no reason to ever resolve `agency_id`, since it's a generic auth call with no
agency-aware wrapper. The FK error on retry was Supabase Auth's documented
anti-enumeration behavior: calling `signUp()` again against an email with an existing
*unconfirmed* `auth.users` row can return a response object that doesn't correspond to a
real, committed row, so the subsequent `user_roles` insert failed against a `user_id`
that was never actually there. (Confirmed empirically during the investigation: both
`profiles.id` and `user_roles.user_id` carry `ON DELETE CASCADE` to `auth.users`, and a
live orphan check found zero orphaned rows anywhere — ruling out a stale leftover row
from an earlier delete as the cause.)

**Fix:** `AddUser.tsx` now calls `create-user` (`userType: 'staff'`, same Edge Function
`Clients.tsx`/`Caregivers.tsx` already used) instead of `supabase.auth.signUp()`. This
closes all three symptoms in one change: pre-confirmed via the Admin API (no more
confirmation wait), a real committed user before `user_roles` is touched (no more FK
error), and `agency_id` resolved server-side from the caller's own profile (never NULL,
never client-supplied) via the same path already proven correct for client/caregiver
accounts. Also split the single "Full Name" field into separate First/Last Name inputs
while rebuilding this form, to avoid reintroducing the same single-full-name-field bug
class already fixed once for family intake (see the `FamilyIntakeSurface.tsx` entry
above).

**Every account-creation path in the app now uses the same Admin-API pattern** — no
remaining `supabase.auth.signUp()` call anywhere in staff/caregiver/client provisioning.

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

## Query-path PHI/PII residual risk accepted only until Tranche 3G's retrieval-mode re-measurement

**Status:** Logged 2026-09-06 while building the Tranche 3C PHI/PII guard. Deliberate,
time-boxed accepted risk, not a bug and not a permanent posture.

**What the guard covers, and what it doesn't:** `search-knowledge`'s Layer 1 guard
(`supabase/functions/_shared/phiGuard.ts`) blocks any anonymous query containing a
detectable structured identifier (SSN/phone/email/DOB-shaped pattern) before it can
reach either retrieval mode, with a refusal indistinguishable from an ordinary
"not grounded" response. It cannot detect name/context PHI in a query (e.g. "Is Jane
Smith on the schedule Tuesday?") -- no reliable detector for that exists under the
project's fixed no-LLM constraint, and there is no server-enforced attestation
mechanism possible on this path the way there is for staff-driven ingestion (an
anonymous visitor cannot be made to attest to anything).

**Why this is accepted rather than blocking:** the public corpus this surface serves
is PHI-free by design (Phase 1 RAG scope), and `phiAllowed` stays `false` with no BAA
underneath this path (Tranche 3D) -- so a visitor typing a name into a question does
not cause PHI to be *stored* as agency knowledge, only to pass through the embedding
provider as part of the query itself. This is the same category of exposure the
Tranche 3C plan's Conditional-A decision explicitly named and time-boxed, not a newly
discovered gap.

**Expires at Tranche 3G, not on a BAA timeline:** `search-knowledge` exposes a
policy-controlled `retrieval_mode` seam (`KNOWLEDGE_RETRIEVAL_MODE` env var, `FTS` or
`VECTOR`, defaulting to `VECTOR`) specifically so this can be revisited on evidence.
At Tranche 3G, before real anonymous traffic hits real public content, both modes
must be re-measured against the *actual* public corpus using `rag-eval-harness` (not
the caregiver seed corpus `SEMANTIC_MATCH_THRESHOLD` was derived from -- see that
entry above). If FTS separates answerable from noise cleanly on that corpus, switching
`retrieval_mode` to `FTS` closes this exposure structurally (no query text ever
reaches an external provider) at no code change. This acceptance is NOT contingent on
BAA/provider status -- it is a corpus-quality measurement, independent of the
Tranche 3D provider decision.

**Deliberately time-boxed, not deferred indefinitely** -- tracked here so the 3G gate
is not skipped once real public content makes this a live question rather than a
theoretical one.

## No stuck-row reaping for ingest-knowledge-document (Tranche 3B, mechanism only)

**Status:** Logged 2026-09-05 during Tranche 3B implementation. Accepted at mechanism
stage, not fixed.

`ingest-knowledge-document`'s `ingestion_status` defaults to `'pending'` for new rows
(correct -- a genuinely new pipeline row starts pending, not ready). If the function
crashes or times out mid-pipeline (`extracting`/`chunking`/`embedding`), that document
row is left stuck at whatever step it reached, with no automatic retry or cleanup.
This is not a content-leak risk -- `knowledge_chunks` rows are only written in one
batch insert after embedding fully succeeds, so a stuck row has zero chunks and is
structurally invisible to both retrieval RPCs regardless of status (see the 3B commit
for the full reasoning) -- but it is an operational gap: a stuck row today requires
manual cleanup (delete the row, re-upload), not a retry button or a background sweep.

**Deliberately out of scope for now** -- automatic reaping/retry is a job-queue-shaped
feature, explicitly deferred alongside async processing per 3B's own scope (synchronous,
single-document Edge Function, "smallest viable"). Revisit when async/queue processing
is built, likely triggered by a real document exceeding Edge Function timeout limits.

## Guard-blocked ingestion leaves an orphaned storage object

**Status:** Discovered during Tranche 3E manual UI validation, 2026-09-06. Benign
today, not fixed.

`ingest-knowledge-document` uploads the raw file to `knowledge-uploads` before the 3C
guard runs, so a guard-blocked file's bytes remain in storage even though it never
becomes chunks/embeddings. Benign now (staff-only bucket RLS), but the eventual real
(non-test-harness) upload UI should delete the storage object on a guard block.

## Duplicate agency-settings module codes (`settings` + `agency_settings`)

**Status:** Found during the nav UX polish pass, 2026-09-08. Cosmetic/data-debt, not fixed.

`system_modules` has two separate rows for the same feature -- `settings` (category
`administration`) and `agency_settings` (category `configuration`) -- both routing to
`/agency-settings`, both granted to `agency_admin`. The existing path-based de-dup in
`AppLayout.tsx` already prevents a visible duplicate sidebar entry, so this has no
current user-facing effect -- but the two module_codes should eventually be
consolidated into one.

## RESOLVED: `pending_notifications` RLS is not agency-scoped -- cross-references the M1 tracking

**Status:** Found while adding the Notification Outbox sidebar badge (UX polish batch
1b), 2026-09-08. Confirmed 🔴 in the M0 verification pass, then **fixed and verified
closed as part of M1, 2026-09-13** — see `docs/m1-security-gate-plan.md` §3.6/§7.3.
All three CRUD policies (SELECT/INSERT/UPDATE, not just SELECT as originally flagged
below) now require `is_agency_staff() AND agency_id = current_agency_id()` (or
`system_admin`). Proven via the M1 two-tenant isolation test: Agency B's admin could
not read or update Agency A's `pending_notifications` rows.

**Original finding (now resolved), kept for history:**

`pending_notifications`'s SELECT policy is role-only (`has_role(system_admin) OR
has_role(agency_admin) OR has_role(manager)`), with **no `agency_id` comparison at
all** -- the same class of gap already tracked for `agency`/`profiles`/`user_roles`/
`conversation_sessions`/`conversation_answers` under Phase M1 (see the multi-tenant
plan). Today, with one agency in the system, this is invisible; the moment a second
real agency exists, any of those three roles in Agency B could read Agency A's
pending notification queue (recipient names/emails, message bodies) through this
table's own RLS.

**The Notification Outbox sidebar badge added in this batch does NOT fix this --
it works around it for the badge specifically.** The badge's count query adds an
explicit `.eq('agency_id', ...)` filter at the query level (see
`useMenuBadgeCounts.ts`), so the NUMBER shown is correctly scoped to the current
user's own agency. But the underlying RLS gap is untouched: **the Notification
Outbox page itself, and any other future direct query against this table, still has
no structural barrier against reading another agency's rows.** The badge fix corrects
what one number displays; it does not close the leak. Fixing the leak itself is
explicitly Phase M1 scope -- deferred to before any second real agency/non-CareMuch
agency-admin login is onboarded, and only provable with a real two-tenant isolation
test, per the multi-tenant plan's own done-definition for M1. Not in scope for this
badge batch, and deliberately not touched here.

## RESOLVED (mechanism): office-scoping — see `docs/m-office-scoping-plan.md`

**Status:** M-Office landed and verified 2026-09-14 (22/22 two-office isolation test
checks passed, teardown confirmed clean). Closes the office-scoping mechanism gap
this section and the next one describe. See the plan doc §7 for the full closure
record, including two mid-implementation bugs found and fixed before testing: a
`CREATE OR REPLACE FUNCTION`-doesn't-replace-on-added-parameter issue that left
`match_agency_knowledge`/`search_agency_knowledge` with duplicate overloads, and (more
seriously) those duplicate overloads briefly carrying default `anon`/`authenticated`
`EXECUTE` grants that reopened the exact bypass Tranche 3A closed -- caught and fixed
via a same-day follow-up migration before any live traffic was at risk.

**Deferred to a later phase, not part of this fix:** `virtual_office_id` columns on
`shifts`/`shift_assignments`/`client_orders`/`order_services`/`time_entries`/
`time_off_requests`/`caregiver_availability` and related tables -- these need a new
column (not just an RLS clause) and were deliberately sequenced after the core
mechanism was proven. `conversation_flows` per-office scoping remains M2's own
scoped phase.

## RESOLVED: `/assistant` is a generic, office-less surface — inconsistent office attribution on submission

**Status:** Found while investigating 6 unattributed caregiver-application/inquiry
rows, 2026-09-09. Data fixed then (all 6 attributed to Ripple Effects). **The
structural gap itself closed 2026-09-14 as part of M-Office** (see
`docs/m-office-scoping-plan.md` §3d/§7): `flow_session_submit_intake` now falls back
to the resolved agency's primary active office (reusing the existing `is_primary`
flag) whenever `p_virtual_office_id` is NULL, exactly mirroring its pre-existing
agency-level fallback. `caregiver_registrations`' direct-insert callers
(`ResultRegistration.tsx`, and a third, previously-undocumented path,
`CaregiverRegistration.tsx` at `/caregiver-registration`) were moved behind one new
`submit_caregiver_registration` RPC carrying the same fallback chain, so all three
public submission paths now land with non-NULL `agency_id`/`virtual_office_id` instead
of two of them silently going unattributed. Verified live: all three paths tested,
each attributed correctly, and the office-scoped path's own explicit office confirmed
*preserved* (not overridden by the fallback).

**Original finding, kept for history:**

**Root cause:** `ConversationSurface`/`FamilyIntakeSurface` both accept optional
`agencyId`/`virtualOfficeId` props that default to `null`. The office-scoped public
page (`PublicOffice.tsx`, `/a/:slug`) correctly passes both through from the visited
office's own record — confirmed live: a real test submission through
`/a/ripple-effects` arrived with `agency_id`/`virtual_office_id` already set to
Ripple Effects, no fix needed. But the older, generic `/assistant` route
(`src/pages/Assistant.tsx`) renders both surfaces with **no office props at all** —
it hardcodes `agencyName="Kind Care Services"` as display text only, never an
`agencyId`. This is a legacy, pre-multi-office surface that was never updated when
`virtual_office` was introduced.

**The two submission paths handle the resulting `null` differently, and neither
fully closes the gap:**
- `caregiver_registrations` (`ResultRegistration.tsx`): inserts `agency_id`/
  `virtual_office_id` directly from props, no server-side fallback of any kind. A
  caregiver screened via `/assistant` gets **both fields NULL** — unattributable to
  any agency or office. (Found 2 such rows, both dated 2026-09-03, predating this
  session's Ripple Effects work — not from recent testing.)
- `care_requests` (`flow_session_submit_intake` RPC): has a **partial** fallback —
  `-- Fall back to the only real agency when the flow is unscoped (legacy /assistant
  path)` picks the one active real agency when `p_agency_id` is null, so `agency_id`
  is never actually NULL in practice today. But there is no equivalent fallback for
  `p_virtual_office_id`, which stays NULL whenever `/assistant` is the entry point.
  The RPC also sets `source = 'assistant_intake'` in this case (vs. `'public_site'`
  for the office-scoped path) — this is exactly the `ClientInquiries.tsx` "Assistant"
  vs. "Public office page" label the source of a report request was asking about.

**Why the agency-level fallback doesn't fully save `care_requests` either:** it
silently picks "the one active real agency" via `LIMIT 1` with no office. That is
correct by accident today (only one real agency exists) and will misattribute the
moment a second real agency's staff use `/assistant` — the SaaS control-plane's
multi-tenant work should either retire `/assistant` in favor of always requiring an
office context, or give it its own real (non-guessed) tenant resolution.

**Not fixed here** — this is a code/architecture gap, not a data problem, and touching
`/assistant`'s routing or the RPC's fallback logic was out of scope for what was asked
(fix 6 specific rows + report the cause). Revisit alongside the SaaS control-plane
work, where every submission surface should be required to carry real, non-guessed
tenant/office context — no silent single-tenant fallback.

**Partial update (M1, 2026-09-13):** the M0 verification pass found that this gap had
compounded into a genuine cross-tenant leak — `caregiver_registrations`' staff
SELECT/UPDATE policies OR'd in `agency_id IS NULL`, so every unattributed registration
(the rows this entry describes) was visible/editable by **any** agency's staff, not
just one. That specific cross-tenant read/write is now closed (see
`docs/m1-security-gate-plan.md` §3.7/§7.3) — NULL-`agency_id` rows are now
system_admin-only, consistent with the same tightening applied to
`conversation_sessions`. **The underlying `/assistant` attribution gap itself (why
these rows end up with `agency_id`/`virtual_office_id` NULL in the first place) is
still not fixed** — this only closed who can see the resulting NULL rows, not the root
cause described above.

## OPEN: staff email edits on a caregiver leave `profiles.email` and the login email out of sync

**Status:** Found 2026-10-02 while drafting M-SEC-2 (`docs/security-fixes-2026-10-plan.md` §8.2).
Pre-existing; not changed by the security batch.

`src/pages/Caregivers.tsx:224` (and `Clients.tsx:304` for clients) update the *other user's*
`profiles` row after a staff edit, but `profiles` has **no staff UPDATE policy** (only
"Users can update their own profile"). PostgREST therefore matches 0 rows and returns no error,
so the write is silently dropped. A staff change to `caregivers.email` updates only the caregiver
record. `profiles.email` and `auth.users.email` (the actual login) keep the old address.

**Why it matters:** `AdminUserManagement.tsx:121,173` finds password-reset and delete targets
**by `profiles.email`**, and the caregiver now sees one email on their profile while logging in
with another. M-SEC-2 makes the login email read-only for caregivers ("contact your office"),
which makes the staff path the only way to change it, and that path doesn't work today.

**Fix direction (separate task):** a staff "change login email" action through an Edge Function.
It would check the caller's role and agency (the M-SEC-2b pattern), call
`auth.admin.updateUserById(id, { email })`, then update `profiles.email` and `caregivers.email`
(or `clients.email`) together with the service role. Do not add a broad staff UPDATE policy on
`profiles`: the M-SEC-2 guard would block scope changes, but a narrow server path is simpler to
reason about.

Verified 2026-10-02 (read-only): all 8 profiles currently match `auth.users.email`, and all 4
linked caregivers match their `profiles.email`. No drift yet.

## REQUIRED BEFORE PRODUCTION: configure custom SMTP and switch account emails to Mode A

**Status:** Logged 2026-10-04 (owner decision Q1, `docs/security-fixes-2026-10-plan.md` §2.2, §15).

**Mode B (shipped 2026-10-04, `2756b25`):** temporary passwords are replaced by one-time invite/reset links that staff
see once and hand over themselves (`auth.admin.generateLink` sends no email). It works without any
mail setup but still puts a credential-bearing link in a staff member's hands.

**Mode A (required before production):**
- configure a custom SMTP provider in Supabase (Auth → SMTP);
- set Site URL and Redirect URLs for the production origin;
- switch the account functions to Supabase-sent invite and recovery emails (`inviteUserByEmail`,
  `resetPasswordForEmail`), so no link passes through staff.

**Why the built-in mailer can't be used:**
- it only delivers to the Supabase organization's own team addresses;
- it is rate-limited to a few emails per hour.

So "Forgot password?" works only for team addresses until SMTP is configured. No Auth/SMTP setting
has been changed by the security batch.

## FUTURE: per-office caregiver registration links (set the agency server-side)

**Status:** Logged 2026-10-05 (owner decision 1, security plan §15.7).

Registrations from `/caregiver-registration` and `/assistant` carry no agency. Since the Issue 2
batch, agency staff can neither see nor approve them; only a system_admin can assign an agency and
office, from the "Unassigned registrations" list on Caregiver Applications. Better: per-office links
(e.g. `/caregiver-registration?office=<slug>`) where the server (the `submit_caregiver_registration`
RPC) resolves the slug to the published office and sets `agency_id` / `virtual_office_id` itself.
The client must never send an id; this mirrors `/a/:slug/apply`.

## FUTURE: role switcher for staff who also work shifts

**Status:** Logged 2026-10-05 (owner decision 3, security plan §14.7).

`get_user_role()` (and so `RequireRole` and post-login routing) resolves a user with several roles to
the highest one. A manager who also works as a caregiver therefore always lands in the staff app and
is redirected away from the caregiver app. None exist today. When they do, add an explicit role
switcher, and let caregiver-app routes accept a user who holds the caregiver role even if it isn't
their highest.

## NOTE: one-time invite / reset links expire after the Supabase default (1 hour)

**Status:** Logged 2026-10-05 (owner point F, security plan §15).

Mode B invite and recovery links (and "Forgot password?" emails) use the project's email-link expiry,
which is the Supabase default of **1 hour**. The UI says so ("It expires in 1 hour"). An invite that
isn't used in time can be replaced by a fresh reset link from the staff screens. Raising the expiry
for invites is an Auth setting and an **owner decision for later**; it has not been changed.

## OPEN: Admin User Management "Reset Password" tab can't find users for a manager

**Status:** Found 2026-10-04 while drafting Mode B (plan §15.5(c)). Pre-existing.

`AdminUserManagement.tsx` resolves the email typed into the Reset tab with a client-side
`profiles` query. `profiles` RLS lets a user read only their own row (plus agency_admin and
system_admin within scope), so a manager always gets "User not found", although
`admin-reset-password` would allow them to reset a lower-ranked user in their agency. The fix
direction is to let the Edge Function accept an email and resolve it server-side with the same
rank and agency checks. The Reset buttons on Users / Caregivers / Clients (which pass a user id)
are not affected.

## FUTURE: "caregiver proposes a skill, staff approves" flow

**Status:** Logged 2026-10-04 with the M-SEC-1 batch (`docs/security-fixes-2026-10-plan.md` §12.1,
owner decision Q7).

Caregiver skills (`caregiver_skills`) are now **staff-managed**. The caregiver Profile shows them
read-only ("To change your skills, contact your office.") and the caregiver role keeps SELECT on its
own rows only. Reason: the eligibility engine's `skill` rule treats any listed care type as
qualified, so a self-added skill made a caregiver eligible for services nobody had vetted.
A later improvement: let a caregiver *propose* a skill (with optional certification proof) into a
pending table that staff approve or reject. Approval writes `caregiver_skills` through the staff
path. Not started.

## OPEN: client "Care Plans" booking cannot be submitted (no client INSERT policy)

**Status:** Found 2026-10-04 during the M-SEC-1 breakage sweep (plan §12.2(a)). Pre-existing; not
caused or fixed by the security batch.

The client dashboard's Care Plans tab (`client-dashboard/OrdersManagement.tsx`) submits a booking by
inserting into `client_orders` and then `shifts` with the signed-in client's JWT. Neither table has
a client INSERT policy:
- `client_orders` has only "Clients read their own care plans";
- `shifts` has only "Clients read their own shifts".

So the submit fails at the first insert. The owner has said clients book through this tab (not
`/order-management`), so it needs a decision:
- a narrow SECURITY DEFINER "request care" RPC that creates a draft order for the caller's own
  client record; or
- routing client requests into `care_requests`, the same inbox as family intake, for staff to turn
  into a plan.

Related, fixed in the same batch: the picker no longer prices the booking with the caregiver's pay
rate (`rate: caregiver.hourly_rate`). It keeps the care-service price.

**Also found 2026-10-04 (browser pass):** step 1 of that booking form ("Select Primary Service")
is **empty for every client**. `OrdersManagement.tsx` keeps only care needs whose care-type
`category` is exactly 'Activities of Daily Living (ADL)', 'Health Monitoring & Care' or
'Instrumental Activities of Daily Living (IADL)'. The live categories are now 'Basic Care',
'Daily Living', 'Medical Support', 'Physical Care', 'Therapeutic Care' and 'Community Programs', so
nothing matches. Continue stays disabled and the caregiver picker (step 2) is unreachable in the UI.
Pre-existing; not changed by the security batch. The picker's data path,
`get_bookable_caregivers()`, was verified at the API level (plan §12.7: R3, O1, O2, D1). Fix
together with the booking-submit decision above: filter by `category_id` / a "primary service" flag
rather than hard-coded category names.

## FUTURE: consider a separate client-editable field (`client_notes`) for the client portal

**Status:** Logged 2026-10-02 with M-SEC-2 (`docs/security-fixes-2026-10-plan.md` §9).

`clients.notes` is the staff "Notes" field (Client Details dialog in `Clients.tsx`). Until M-SEC-2
the client portal's Profile form (`client-dashboard/ProfileSettings.tsx`) let a client overwrite it.
Owner decision: staff notes must not be client-editable, so M-SEC-2 freezes `notes` for the client
role, and the client form no longer shows or sends it. That removed the client's only free-text
field ("Additional Notes — any additional medical information or special requirements").
If clients need to tell the agency something, add a separate `client_notes` column, shown to staff
as client-supplied and kept distinct from staff notes.

**Related, still open:** the client can still **read** staff-internal fields on their own row.
`ClientDashboard.tsx:98` loads it with `select("*")`, and the client self-SELECT policy returns
every column: `notes`, `scheduling_notes`, `care_requirements`, `medical_conditions`,
`preferred_caregiver_id`. Hiding the textarea does not stop an API read. If staff notes must also
be private from the client, serve the client's profile through a narrow view/RPC, following the
`get_caregiver_visible_clients()` pattern. That needs a product decision on which fields a client
may see.

## RESOLVED: October 2026 security fixes (role isolation, plaintext passwords, write-on-load)

**Status:** Closed 2026-10-04 on the DEV project `rgeldgztadebgvrdhaqa`. Plan, before/after results
and owner decisions: `docs/security-fixes-2026-10-plan.md`. Every step was tested with real JWTs and
disposable fixtures, with teardown verified by re-query.

| What closed | Commit |
|---|---|
| M-SEC-2: users can't change their own agency/office/role scope; caregiver/client self-update allow-lists; agency_admin can't create or alter system_admin rows | `f2b4aa2` |
| M-SEC-2b: role + agency checks in create-user, admin-reset-password, admin-delete-user, link-existing-accounts | `a954cfc` |
| M-SEC-1: caregivers/clients no longer read or write other people's staff-level rows inside their agency; M-SEC-3 `get_my_trade_requests()`; M-SEC-5 display-safe client reads of caregivers; Q7 skills staff-managed | `a7eb540` |
| M-SEC-4 + RequireRole: every staff/admin route guarded; menu seeds; hardened `?next=`; Delete-user hidden for managers | `419fed0` |
| Issue 2 (Mode B) + M-SEC-6: no staff-typed or stored passwords; one-time invite/reset links, audited (`account_link_issued`); no cross-agency account takeover through the login functions; Forgot password | `2756b25` |
| Write-on-load: public chat pages no longer create a `conversation_sessions` row before the first answer | `72b6d3c` |
| E5 (data): 4 stored temporary passwords redacted from `pending_notifications`; the 4 demo accounts force-reset to unknown passwords; sessions revoked (0 were active) | data statements, plan §17 |
| E7 (data): the 2 empty anonymous sessions from the Oct 1 capture deleted | data statement, plan §17 |

The "Caregivers cannot see open/unassigned shifts" entry above was already closed by Smart
Scheduling Phase 1B and is now marked RESOLVED.

## OWNER ACTION BEFORE PRODUCTION: server-side password minimum and leaked-password protection

**Status:** Measured 2026-10-04 (after-test PW, plan §15.9). Not changed: the owner keeps Auth settings.

The Supabase Auth server accepts 6- and 7-character passwords (its default minimum is 6). The app
asks for 8–72 characters on `/auth/set-password`, but only in the browser, so the API alone allows
shorter passwords. Before production, in the Supabase dashboard (Auth → Providers → Email / Password
security):
- set the minimum password length to **8**;
- enable **leaked-password protection** (HaveIBeenPwned check).

## OPEN: open shifts show `special_notes` / `special_instructions` to every caregiver in the office

**Status:** Logged 2026-10-04 (owner decision Q5: a follow-up slice, not the security batch).

The policy "Caregivers view open shifts in their office" (`20260915215024`) returns the whole
`shifts` row. That includes free-text `special_notes` / `special_instructions`, which can carry care
details, to every caregiver who can see the open shift. Decision taken: caregivers keep date, time,
service, city, client first name + last initial and `pay_rate`; the notes stay hidden until the
caregiver is assigned. Do this through a view or a `SECURITY DEFINER` RPC (CLAUDE.md #14), and
switch `AvailableShifts` to it.

## OWNER ACTION: retire the old Lovable Cloud project `jipsobxiblzgivjmtwtq`

**Status:** Logged 2026-10-04 (plan §3.1).

The app runs only on `rgeldgztadebgvrdhaqa`. The old Lovable Cloud project is disconnected, but its
URL and anon key are in git history (the old `.env`, before `a297165`), and
`supabase/functions/mcp/index.ts` still names it as the OAuth issuer. The repo can't tell whether
that project still exists. Owner: confirm it is paused or deleted (or rotate its keys), then fix the
stale issuer in the `mcp` function (see also the "AUDIT NEEDED: Lovable-dashboard-authored config"
entry above).

## OWNER ACTION: owner account password hash committed in `20251110220912`

**Status:** Logged 2026-10-04 (plan §2.4).

`supabase/migrations/20251110220912_*.sql` (lines 20–33) seeds the owner's own `auth.users` row with
a literal, weak password hash. It is in git history for good. If that account still uses that
password, change it (Forgot password, or a reset link from another admin). The migration is
already applied, so editing the file changes nothing in the database.

## OPEN (narrowed): `caregiver_certifications` staff READ policy has no office check

**Status:** Logged 2026-10-04 (Ripple Phase A review). **Writes fixed in Phase B1:** staff direct
writes are refused, and credentials are entered only through `enter_caregiver_credential`, which
checks the caller's role and office scope (B1 suite C1). **Still open:** the staff SELECT policy
"Agency staff read certifications in their agency" is agency-only, so an office-restricted staff
member can read other offices' caregivers' certifications. The original note follows.

The policy "Agency staff manage certifications in their agency" checks only staff role + agency
(`caregiver_agency_id(caregiver_id) = current_agency_id()`). An office-restricted staff member can
therefore read and write certifications of caregivers in other offices of the same agency. Phase A
extends this table (R3: `credential_type_id`, `effective_date`, `entered_by`) but leaves its policy
as it is.

**Fix with the Phase B credential RPC** (`upsert_caregiver_credential`, Q17 role checks):
- move staff writes to the RPC;
- replace the policy with an office-scoped read through the caregiver's office (M-Office
  predicate), training tier (manager, agency_admin, hr_staff).

## OPEN: any in-scope staff role can edit `virtual_office` configuration

**Status:** Logged 2026-10-04 (Ripple Phase A review; not fixed now).

`vo_update_staff` / `vo_insert_staff` / `vo_delete_staff` admit any `is_agency_staff` role (scheduler
and hr_staff included) for offices in their scope. So those roles can change scheduling overrides,
`smart_match_weights`, service area, branding and the public page content. Phase A guards only the
new columns (`compliance_enforcement_enabled`, `care_plan_module_enabled`, `billing_week_start`),
which are agency_admin / system_admin only.

**Needed:** a manager+ allow-list guard trigger on `virtual_office` (M-SEC-2 pattern: listed
columns for manager+, everything else frozen for lower roles), or narrower policies.

## TIDY LATER: default privileges grant TRUNCATE to anon/authenticated on 44 public tables

**Status:** Logged 2026-10-04 (read-only catalog check).

Supabase's default privileges give `anon` and `authenticated` every table privilege, including
TRUNCATE (which RLS does not apply to), on new public tables. Currently 44 tables grant TRUNCATE to
`authenticated` and 6 to `anon`.
- **Not reachable via PostgREST** (the API never issues TRUNCATE), and those roles can't log in
  directly.
- **Tidy later:** a migration revoking TRUNCATE (and REFERENCES / TRIGGER) from anon and
  authenticated on existing tables, plus `ALTER DEFAULT PRIVILEGES` so new tables don't get them.
- The Ripple Phase A tables already revoke them explicitly (schema plan §2.1).

## REQUIRED BEFORE PRODUCTION: load the care-plan default catalogs before enabling the module

**Status:** Logged 2026-10-04 (Ripple Phase B1, owner decision).

`seed_office_care_plan_defaults(_office_id)` copies defaults from two system tables when an
agency_admin enables the care-plan module for an office:
- `cp_default_credential_types` (the credential checklist);
- `cp_default_service_types` (care_type_code → service_type mappings).

Their content is deployment reference data (on DEV, the ISK/Michigan checklist), so no migration
fills them. On a new project they start **empty**: enabling the module would copy nothing.

**Before enabling the module for a real agency:** load both tables through a reviewed
reference-data step with count checks, as `scripts/seed/care_plan_defaults_dev_seed.sql` does on
DEV. Then verify:

    SELECT count(*) FROM public.cp_default_credential_types;
    SELECT count(*) FROM public.cp_default_service_types;

## RESOLVED (part): S-OFF-1 — caller office scope in the staff scheduling write paths

**Status:** Found 2026-10-04 by the Ripple D3 done-test (S8). An office-Y manager assigned a caregiver
to an office-X shift. Fixed on DEV the same day (`d62e1eb`, migration
`20261011120000_soff_01_office_scope_guards.sql`).

**Cause:** these paths checked the caller's role and agency but never the caller's office (M-Office
Tier 3). Phase 0 had recorded cross-office assignment as "expected", and Rule B (Phase 1B) only
added the caregiver-office = shift-office check.

**Fixed (one guard each, the `cp_staff_in_scope` / M-Office predicate, generic denial):**
- `assign_caregiver_to_shift`, `release_shift_assignments`, `compute_earnings_for_time_entry`
  (SECURITY DEFINER; same signatures and ACLs);
- Edge Functions, through the shared `_shared/authz.ts` principal:
  - `canActOn` → `admin-reset-password` and `admin-delete-user`;
  - `enable-caregiver-login` and `enable-client-login`;
  - redeployed with `verify_jwt` unchanged (true);
- tests: `tests/ripple/pglite/soff.cjs`, `tests/ripple/dev/soff.cjs`, D3 S8.

**Already office-scoped (sweep, no change):** RLS on `shifts`, `shift_assignments` (UPDATE),
`time_off_requests` (decide), `time_entries` (staff), `caregivers`, `client_orders`; the Ripple RPCs
(`cp_require_scope`); `create-user` (puts a restricted caller's users in its own office).
Caregiver self-service (`caregiver_pick_up_shift`, trade pick-up) is bound to the caller's own
caregiver row, and Rule B pins the caregiver's office to the shift's office.

**Still open:** the remaining agency-only paths are grouped below as **S-OFF-2**.
`create-user` was not redeployed: it imports the changed `_shared/authz.ts`, but uses only
`loadPrincipal`/`hasCallerRole`, whose behaviour for it is unchanged. Redeploy it with its next
change.

## OPEN: S-OFF-2 — fix before any multi-office agency goes live with real data

**Status:** Grouped 2026-10-04 (owner). No code yet. These are the office-isolation gaps the S-OFF-1
sweep found and left because each is bigger than a one-line guard. Together they mean an
office-restricted staff member (M-Office Tier 3) can still act on another office of the same agency
through these paths. **Gate:** all four are fixed and tested (PGlite + DEV, office-Y vs office-X, as
in `tests/ripple/dev/soff.cjs`) before any agency with more than one office goes live with real data.

1. **`shift_trades` staff writes.** The INSERT and UPDATE policies are agency-only (details in the
   `shift_trades` entry at the top of this file). Needs an office for the trade (a column, or one
   derived through the shift) and office-scoped policies.
2. **`caregiver_availability`, `caregiver_availability_exceptions`, `caregiver_skills` staff
   policies.** They are agency-only, so a restricted staff member can change another office's
   caregivers' availability and skills. Needs office-scoped policies through the caregiver's office.
3. **`convert_care_request_to_client`** (SECURITY DEFINER) checks agency only. A one-line guard is
   possible (`care_requests.virtual_office_id` is never NULL on DEV today), but it needs a product
   decision on who converts which office's requests.
4. **`approve-caregiver-registration`** (Edge Function, service role) checks role + agency only.
   Registrations carry no office yet, so there is nothing to compare. Fix together with "FUTURE:
   per-office caregiver registration links".

Items 1–2 are RLS tightenings. Run the write-path audit first (every writer of those tables, not
just the named ones), because the service role bypasses RLS and the authenticated client doesn't.

## OPEN: Ripple care-plan module — defaults awaiting Ripple, and deferred features

**Status:** Logged 2026-10-04 (backend A–D done on DEV). Current defaults (schema plan §12, §13):
- **Q11 billing week:** Monday–Sunday, per office (`virtual_office.billing_week_start`, default 1)
  until Ripple confirms ISK's week.
- **Q12 review:** per-note review plus "bulk-approve clean rows" until Ripple says otherwise.
- **Q18 late arrival / early departure:** the current rule is kept (more than 5 minutes late loses
  the first 15-minute unit). Billing only the units actually delivered awaits Ripple.
- **E-signature:** notes carry a typed signature and timestamp. Acceptance of that as an
  e-signature awaits Ripple; electronic archiving is a later phase.
- **Notifications (R9):** V1 shows computed status only (overdue notes, retraining list,
  onboarding). Sending notifications is a later phase.

Also before production (separate entries): load the care-plan default catalogs; server-side
password minimum and leaked-password protection; custom SMTP / Mode A.

## OPEN (Ripple S4): intake upload deferred (S4b). RESOLVED: authorization void (W2, Oct 5)

- **Void (W2) — RESOLVED Oct 5 (`20261015120000`, owner-approved change to existing objects):** `voided_at / voided_by / void_reason`;
  `void_service_authorization` only when no note references it, no schedule line points at it and the projection allocates
  nothing to it; every reader skips voided rows; a voided number may be re-entered (partial unique index over active rows).
- **S4b:** intake documents are metadata only in V1 (type, status, effective/expiration, N/A reason). File upload needs a
  private bucket with office-scoped storage policies and its own security review. `client_documents` has no free-text note column;
  the N/A reason is the only note today.
- **Measure-type / correction audit:** W1 and W2 events carry ids, kinds and changed field names; the correction event also
  carries the staff-typed reason (owner decision: "audited with the reason").

## OPEN (Ripple S6): In-service print is a provisional layout, pending Ripple's form sample

`/training/:clientId/print/inservice/:formId` prints the IPOS In-service form from the architecture description (header,
case manager and program lead signature lines, shell field values). No scan of the paper form is in the repo; the owner will
provide a redacted sample, and the layout is adjusted to it then. The 33.01_01F training form print follows arch §1.3.
