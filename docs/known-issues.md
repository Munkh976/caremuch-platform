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
