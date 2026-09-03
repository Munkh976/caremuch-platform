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

## AUDIT NEEDED: other Lovable-dashboard-authored config may be missing (third instance found)

**Status:** Found while diagnosing why the Conversation Builder showed only one flow
tab (2026-09-02). Not yet audited systematically — logged so the remaining instances
get found by audit, not one feature at a time.

**Pattern, confirmed three times now:**
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

**Root cause:** any configuration or content authored directly through Lovable's
hosted dashboard/editor — not written as a tracked migration — lives only in that
project's live database. It was never captured in version control, so it had no way
to survive the move to a different Supabase project ref. The code and schema for all
three features were always intact; only UI-authored *data* was lost.

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
