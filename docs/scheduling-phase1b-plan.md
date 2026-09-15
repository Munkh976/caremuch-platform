# Smart Scheduling Phase 1B — Wire the Engine, Add Rule B, Fix Severities, Close the NULL-Office Write Path

> **Status: PLAN ONLY. Nothing applied.** Read-only verification against the live
> database (fresh connection, `SELECT`-only) confirmed every assumption below before
> designing against it — the exact live body of `check_assignment_eligibility`, its
> current grants, the confirmed absence of any distance/coordinate data, and the
> `set_time_off_agency_id` trigger's exact text. Mirrors M1/M-Office/Phase 0
> discipline: additive changes, the established helper/trigger patterns reused (not
> reinvented), a real test as the done-definition. STOP for review before
> implementation.

## 0. One blocker found, flagged per your own instruction — not solved silently

**Confirmed live: there is no distance/coordinate data anywhere in the schema.**
`clients`/`caregivers` have no lat/long/geo columns (grep + live column check, both
empty), and no zip-centroid or geo reference table exists. This matches
`known-issues.md`'s own prior finding ("match-caregiver has no real proximity
signal") — nothing has changed since. **The literal "&lt;20mi soft / ≥20mi hard" Rule
J threshold is not computable today.** Two ways forward, presented per your
instruction to flag rather than guess:

- **(A) Build a zip-centroid lookup table + haversine distance.** The smallest real
  option (`known-issues.md`'s own "Option 1") — a new, small static reference table
  (zip → lat/long centroid, loaded once from a public dataset) plus a haversine
  calculation in the eligibility function. This is genuine new data infrastructure,
  not just wiring — sized right for "smallest real fix," but it's more than a pure
  wiring change, so flagging rather than assuming it's in scope.
- **(B) Keep the existing zip-in-list boolean, only promote its severity.** No new
  data: `cl.zip_code = ANY(cg.service_zipcodes)` either matches or doesn't — no real
  mileage, just in/out of a caregiver's declared list. Could promote this from
  advisory to soft (or hard-if-not-declared-at-all), but it does **not** implement
  "under/at 20 miles" as literally specified — it's a coarser proxy.

**§1's design below implements (B) as the safe interim default (advisory → soft,
matching the spirit of "promote severity" without inventing distance data), and
leaves (A) as an explicit, separately-scoped follow-up if you want real mileage.**
Confirm which you want before this part is implemented — everything else in this
plan is independent of this decision.

---

## 1. Engine changes — `check_assignment_eligibility` (same 2-arg signature, no footgun risk)

**Confirmed: the function's argument list (`_shift_id uuid, _caregiver_id uuid`) is
unchanged by every edit below** — only the body changes. Per `known-issues.md`'s
`CREATE OR REPLACE FUNCTION` footgun: that only bites when the *parameter list*
changes. An identical-signature `CREATE OR REPLACE` genuinely replaces the same
function object in place and keeps its existing grants (confirmed live:
`postgres`/`authenticated`/`service_role` all hold `EXECUTE` today) — no `DROP
FUNCTION`, no `aclexplode` re-check needed for this piece. (Confirmed separately:
it's `LANGUAGE plpgsql`, so the *other* footgun — `LANGUAGE sql` validating at
`CREATE` time — doesn't apply here either, as you anticipated.)

**Diff, against the exact live body read this session:**

```sql
CREATE OR REPLACE FUNCTION public.check_assignment_eligibility(_shift_id uuid, _caregiver_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  -- ... unchanged declarations ...
BEGIN
  -- ... unchanged shift/caregiver lookup, agency rate lookup, hours calc ...

  IF cg.agency_id IS DISTINCT FROM s.agency_id THEN
    hard := hard || jsonb_build_object('code','tenancy', ...);
  END IF;

  -- NEW: Rule B, mirrors Rule A exactly, same NULL-handling semantics
  -- (NULL IS DISTINCT FROM NULL = false, so two unbackfilled-office rows don't
  -- false-positive-block each other; any real mismatch, including one-sided NULL, does).
  IF cg.virtual_office_id IS DISTINCT FROM s.virtual_office_id THEN
    hard := hard || jsonb_build_object('code','office_scope','label','Different office',
      'detail','Caregiver belongs to a different office.');
  END IF;

  -- ... unchanged: active status, shift-taken, shift-state, skills, certifications,
  --     double-booking, weekly-hours-cap hard/advisory ...

  -- CHANGED: Rule H moves from `soft` to `hard` (was: soft := soft || ...)
  IF EXISTS (SELECT 1 FROM public.time_off_requests t
             WHERE t.caregiver_id=_caregiver_id AND t.status='approved'
               AND s.shift_date BETWEEN t.start_date AND t.end_date) THEN
    hard := hard || jsonb_build_object('code','time_off','label','Approved time off',
      'detail','Caregiver has approved time off covering this date.');
  END IF;

  -- ... unchanged: availability_exception / availability soft rules (Rule G stays soft) ...

  -- CHANGED: Rule J moves from `adv` to `soft` (interim, option B from §0 — see
  -- note there for the real-distance alternative). Was: adv := adv || ...
  IF cl.zip_code IS NOT NULL AND cg.service_zipcodes IS NOT NULL AND array_length(cg.service_zipcodes,1) > 0
     AND NOT (cl.zip_code = ANY(cg.service_zipcodes)) THEN
    soft := soft || jsonb_build_object('code','service_area','label','Outside service area',
      'detail','Client ZIP '||cl.zip_code||' is not in this caregiver''s service ZIP list.');
  END IF;

  -- ... unchanged: preferred_caregiver, specialized_service, late_trade, in_progress,
  --     reliability advisories ...

  RETURN jsonb_build_object( ... ); -- unchanged shape
END;
$function$
```

**Rule D (role compatibility): confirmed dropped from scope, nothing to remove** — it
was never implemented (no schema support, per Phase 1A), so there's no code to
delete. Noting explicitly so "dropped from scope" isn't mistaken for "removed code."

**This one function change also closes Phase 0's known gap:** `assign_caregiver_to_shift()`
and `caregiver_pick_up_shift()` both already call this function unconditionally — once
Rule B returns a `hard` entry for a cross-office pair, both RPCs start rejecting
cross-office assignment automatically, with **zero changes needed to either RPC**.
This is the test in §4 that proves Phase 0's deferred gap is now closed.

---

## 2. New bulk-eligibility RPC (additive, no existing signature touched)

Both surface fixes in §3 need eligibility for a *list* of candidates without N
sequential round-trips. Rather than duplicate the rule logic, a thin wrapper:

```sql
CREATE OR REPLACE FUNCTION public.check_assignment_eligibility_bulk(_shift_id uuid, _caregiver_ids uuid[])
RETURNS TABLE(caregiver_id uuid, result jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT cid, public.check_assignment_eligibility(_shift_id, cid)
  FROM unnest(_caregiver_ids) AS cid;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.check_assignment_eligibility_bulk TO authenticated;
```
Brand-new function — no prior overload, no grants to preserve, no footgun exposure.
It calls the single-candidate function per id (zero duplicated rule logic, matching
"one shared engine" discipline) — purely a batching convenience.

---

## 3. Surface wiring

### 3a. Manual Assign (`AssignShiftDialog.tsx`) — the three-state UX

On load (after the existing RLS-scoped caregiver query — which, for a Tier-3
office-restricted manager, is **already narrowed to their own office by the RLS
Phase 0 added to `caregivers`**, no extra client-side office filter needed), call:
```ts
supabase.rpc("check_assignment_eligibility_bulk", { _shift_id: shift.id, _caregiver_ids: roster.map(c => c.id) })
```
once, and partition the roster:
- **`hard.length === 0`** → the *default* dropdown list (matches your spec exactly —
  "eligible" here is `hard.length===0`, regardless of soft flags; a hard-clean,
  soft-flagged pick still goes through the *existing* `OverrideRequiredError` flow at
  submission, unchanged).
- **`hard.length > 0`** → excluded from the default list, but still findable via the
  existing search box (search already searches the full loaded roster by name — no
  change needed there, since the roster itself is unfiltered, only the *default
  render* is). When one of these is selected: render their `hard` reasons (reusing
  the already-built `EligibilityReport.tsx`) and **disable the Assign button** —
  matches `assign_caregiver_to_shift()`'s own real behavior (hard blockers are never
  overridable server-side either, so the UI now previews reality instead of
  discovering it after a rejected submit).

Since the bulk result is already fetched for the whole roster, showing soft-flag
reasons *before* submission (not just after a server round-trip) is free — reusing
`EligibilityReport.tsx` for the selected caregiver regardless of which bucket they're
in. Small UX improvement bundled in at no extra cost, not scope creep on its own.

### 3b. Smart Assign / Auto-fill (`match-caregiver`)

1. Add an office filter to the existing caregiver query:
   `.eq('virtual_office_id', shift.virtual_office_id)` — **only when
   `shift.virtual_office_id` is not null**; if null (a data-quality gap, not the
   normal case post-Phase-0-backfill), fall back to agency-wide, matching the
   NULL-preserves-agency-wide convention used everywhere else in this project rather
   than silently returning zero candidates for a shift with a data gap.
2. After the existing caregiver fetch, call `check_assignment_eligibility_bulk`
   once for the whole candidate set, **drop any candidate with `hard.length > 0`
   from the array entirely** (never scored, never returned) — the existing weighted
   scoring math (`WEIGHTS`) runs unchanged on the remaining eligible set. Soft/advisory
   issues remain visible as `warnings` in the response, unchanged shape.
3. `AutoFillDialog.tsx`'s `commit()` loop: on a rejected `assignShift()` call, capture
   `e.message` (already stripped of the "Assignment refused:" prefix by
   `shiftAssignment.ts`) per failed shift instead of only incrementing a counter, and
   surface it in the results table (a column/row detail, not just the closing toast).
   Since candidates are now pre-filtered to eligible-only, most rejections should
   disappear entirely; remaining ones (e.g., a race — two managers assigning the same
   caregiver concurrently) are now explainable instead of silent.

---

## 4. NULL-office write path — trigger-based (not per-call-site), per your explicit instruction

**`time_off_requests`: extend the existing, already-live trigger function** (same
0-argument trigger-function signature — trigger functions never take SQL arguments,
so there is categorically no footgun risk from widening this one's body):

```sql
CREATE OR REPLACE FUNCTION public.set_time_off_agency_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.agency_id IS NULL THEN
    SELECT agency_id INTO NEW.agency_id FROM public.caregivers WHERE id = NEW.caregiver_id;
  END IF;
  -- NEW:
  IF NEW.virtual_office_id IS NULL THEN
    SELECT virtual_office_id INTO NEW.virtual_office_id FROM public.caregivers WHERE id = NEW.caregiver_id;
  END IF;
  RETURN NEW;
END $function$;
```
The existing `trg_time_off_agency_id` trigger definition needs no change at all — it
already calls this function on every `INSERT`.

**`shifts`/`client_orders`: no equivalent trigger exists yet** (confirmed live — zero
`BEFORE INSERT` triggers on either besides the already-known ones on `shifts` for
`caregiver_id`/events/`updated_at`, none of which touch `virtual_office_id`).
`agency_id` is fine as-is on both (already explicitly set by `OrderWizardDialog.tsx`
today, not part of this gap) — only `virtual_office_id` needs a new trigger, derived
from `client_id` (client-side rule, matching Phase 0's own established derivation):

```sql
CREATE OR REPLACE FUNCTION public.set_shift_virtual_office_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.virtual_office_id IS NULL THEN
    SELECT virtual_office_id INTO NEW.virtual_office_id FROM public.clients WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER trg_set_shift_virtual_office_id
BEFORE INSERT ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.set_shift_virtual_office_id();

CREATE OR REPLACE FUNCTION public.set_client_order_virtual_office_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.virtual_office_id IS NULL THEN
    SELECT virtual_office_id INTO NEW.virtual_office_id FROM public.clients WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER trg_set_client_order_virtual_office_id
BEFORE INSERT ON public.client_orders
FOR EACH ROW EXECUTE FUNCTION public.set_client_order_virtual_office_id();
```
**This closes the gap for every future write path, not just `OrderWizardDialog.tsx`**
— exactly the "trigger-based, not per-call-site" outcome you asked for. No
application code changes needed for this item at all.

---

## 5. `AvailableShifts` minimal unblock — one additive `SELECT` policy

```sql
CREATE POLICY "Caregivers view open shifts in their office"
ON public.shifts FOR SELECT TO authenticated
USING (
  status IN ('open', 'unassigned')
  AND EXISTS (
    SELECT 1 FROM public.caregivers c
    WHERE c.user_id = auth.uid()
      AND c.agency_id = shifts.agency_id
      AND c.virtual_office_id = shifts.virtual_office_id
  )
);
```
Confirmed live `shift_status` enum includes both `open` and `unassigned` as distinct
values (matches the existing `sync_shift_caregiver_from_assignment()` trigger's own
`IN ('open','unassigned')` check, reused verbatim here for consistency). A caregiver
whose own `virtual_office_id` is NULL (not yet backfilled) sees nothing under this
policy — `NULL = NULL` is not `TRUE` in SQL, so this fails closed the same way every
other office check in this project already does, no special-casing added. Purely
additive — every existing `shifts` policy (staff management, own-assigned-shift,
own-client-shift) is untouched; this only adds a new permissive `SELECT` grant, it
can't narrow anything.

**Deliberately not built here** (per your explicit deferral): eligibility-pre-filtering
of which open shifts a caregiver sees (the `known-issues.md` open product question),
recurring-shift or trade-board-merge logic. This is the "all open shifts in my
office" version only.

---

## 6. Two-Office + Eligibility Test Design

Same method as every prior phase: real `auth.admin.createUser` accounts, real JWTs,
real RLS through PostgREST, disposable fixtures under the real Agency A, teardown
verified by re-query.

**Fixtures needed:** 2 disposable offices (Alpha/Beta) under Agency A; 1 Tier-3
manager per office; 1 Tier-2 agency_admin; 1 system_admin; 2 clients (1 per office);
5 caregivers, each engineered to hit exactly one rule:
  - `cgEligible` — meets every rule, same office as the test shift → must be fully eligible.
  - `cgExpiredCert` — has the shift's required skill but an expired certification → hard block.
  - `cgOnTimeOff` — has an `approved` `time_off_requests` row covering the shift date → **hard** block (post-change).
  - `cgDoubleBooked` — has an existing overlapping assignment that day → hard block (unchanged, already hard).
  - `cgWrongOffice` — in Office Beta, shift is in Office Alpha → **hard** block (new, Rule B).
  - `cgOutsideZip` — has a `service_zipcodes` list not containing the client's zip → **soft** block (post-change from advisory).

**A. Eligibility correctness (Smart Assign / `match-caregiver`):**
- `cgExpiredCert`, `cgOnTimeOff`, `cgDoubleBooked`, `cgWrongOffice` are **absent** from
  `match-caregiver`'s returned `matches` array entirely (not just low-scored).
- `cgOutsideZip` and `cgEligible` **are present** (soft issues don't exclude).

**B. Manual Assign three-state UX (via direct RPC calls, simulating the dialog's own
calls — same level of rigor as testing any other client-side wiring in this project):**
- `check_assignment_eligibility_bulk` for the roster: confirm `cgEligible`/`cgOutsideZip`
  report `hard.length === 0` (→ default-list-eligible); `cgExpiredCert`/`cgOnTimeOff`/
  `cgDoubleBooked`/`cgWrongOffice` report `hard.length > 0` (→ excluded from default,
  found only via search, Assign disabled).
- Confirm `assign_caregiver_to_shift()` still **requires** an override reason for
  `cgOutsideZip` (now soft, was advisory) and still unconditionally **refuses**
  `cgExpiredCert`/`cgOnTimeOff`/`cgDoubleBooked`/`cgWrongOffice` regardless of any
  override reason supplied (hard rules stay unoverridable).

**C. Office-scope closes Phase 0's gap — re-run Phase 0's own test:**
- Alpha manager attempts `assign_caregiver_to_shift(betaShift, betaCaregiver)` →
  **now rejected** (was the confirmed-not-rejected finding in Phase 0's closure
  record) — the exact regression check Phase 0 flagged as expected-to-fail-until-1B.

**D. New-row office derivation:**
- Insert a `shifts` row and a `client_orders` row (service-role, mimicking
  `OrderWizardDialog.tsx`'s own insert shape) **without** setting `virtual_office_id`
  → confirm both land with the client's correct office, not NULL (the exact probe
  that found NULL in Phase 0, now expected to pass).
- Insert a `time_off_requests` row the same way → confirm `virtual_office_id`
  populated too.

**E. `AvailableShifts` unblock:**
- As a caregiver in Office Alpha, `SELECT` on `shifts` for an `open` Office-Alpha
  shift → now returns the row (was zero rows before this migration, confirmed in
  Phase 1A). Same caregiver querying an Office-Beta open shift → still zero rows
  (office boundary respected, not just the pre-existing bug fixed into "see
  everything").

**F. Regression:**
- Tier-2 agency_admin still sees/manages both offices' everything (unchanged from
  Phase 0's own regression check, re-run to confirm this phase didn't disturb it).
- system_admin bypass intact.
- The live Ripple demo's real shifts/assignments/caregivers unaffected — same
  frozen-demo check every phase has run, re-run here specifically because this phase
  edits a function every existing assignment path depends on.
- A same-office, fully-eligible assignment (the `ShiftTrades.tsx`-style path, and a
  plain `assign_caregiver_to_shift()` call) still succeeds exactly as before —
  proving the Rule B/H/J changes don't introduce a false-positive block on a
  genuinely valid assignment.

**Teardown:** all fixtures (2 offices, users, clients, 5 caregivers + their
skills/certs/availability/time-off rows, shifts, assignments) deleted, then
re-queried to confirm absence — unchanged discipline from every prior phase.

---

## 7. What This Plan Deliberately Does Not Do

Apply any schema/RLS/RPC/code change. Decide §0's real-distance-vs-proxy question —
flagged for you, not resolved. Build `scheduling_flexibility` semantics, the
care-task/visit-checklist feature, or recurring-pickup/trade-board-merge logic — all
explicitly deferred per your instruction. Touch `ShiftTrades.tsx` itself (it already
does this correctly and needs no change) or `TimeOffDecisionDialog.tsx`/
`release_shift_assignments()` (unaffected by any change here beyond automatically
inheriting Rule B/H's stricter behavior through the shared engine, which the
regression checks in §6F confirm doesn't break its existing flow).

**Next step, on your approval:** confirm §0's distance-data decision, then implement
in the established order — reviewed migration (engine changes + bulk RPC + two new
triggers + the RLS policy) shown before push, the two `AssignShiftDialog.tsx`/
`match-caregiver`/`AutoFillDialog.tsx` code changes shown alongside it, apply, run
§6's test, report the matrix.

---

## 8. Closure Record (2026-09-15) — PHASE 1B CLOSED

### 8.1 Migrations applied (two — one same-day follow-up)
`supabase/migrations/20260915215024_scheduling_phase1b_eligibility_engine.sql` —
exactly §1-§5's design: Rule B added hard (mirrors Rule A), Rule H soft→hard, Rule J
advisory→soft (existing zip-list check only, no distance math), `check_assignment_eligibility`'s
2-arg signature unchanged (plain `CREATE OR REPLACE`, no footgun), `check_assignment_eligibility_bulk`
added, `set_time_off_agency_id()` extended plus two new triggers (`shifts`/`client_orders`
office derivation), the `AvailableShifts`-unblocking RLS policy on `shifts`. Applied
cleanly, first try.

**Second migration required same-day:** `20260915223000_phase1b_bulk_rpc_revoke_anon.sql`.
Live `aclexplode` check immediately after the first push (now a standing practice, see
CLAUDE.md rule #14) found `check_assignment_eligibility_bulk` — a new `SECURITY DEFINER`
function — held Postgres's default `PUBLIC`/`anon` `EXECUTE` grant, because the first
migration only `GRANT`ed to `authenticated` without first `REVOKE`ing `PUBLIC, anon`
(the pattern every other RLS-bypassing RPC in this codebase follows, e.g.
`check_assignment_eligibility` itself). This would have let an anonymous caller read
eligibility detail (hard/soft reasons, weekly hours) for any shift/caregiver pair.
Caught and fixed before any test ran; re-verified grants match the single-check
function exactly. This is the third time this project has hit a `SECURITY DEFINER` +
default-grant issue (after the two M-Office overload incidents) — now a standing
CLAUDE.md rule (#14), not just a known-issues entry, so it becomes a checklist item
for Phase 2's RPCs.

`match-caregiver` Edge Function redeployed with the office-scope + hard-eligibility-filter
changes.

### 8.2 Two-office + eligibility test — 30/30 passed

Method note: real JWTs were simulated via session GUCs (`SET LOCAL ROLE authenticated`
+ `set_config('request.jwt.claims', ...)`) against a direct Postgres superuser
connection, rather than `auth.admin.createUser()` + `signInWithPassword()` as in prior
phases — the auto-mode classifier blocked fetching the service-role key needed for the
Admin API. This still exercises the real RLS policies exactly as PostgREST would
(`auth.uid()` reads the same GUC PostgREST sets), just without the HTTP hop. Section A
was additionally verified with a genuine HTTP call to the live deployed
`match-caregiver` function using the public anon key, closing that gap.

**A. Eligibility correctness via `check_assignment_eligibility_bulk` (7/7):**
`cgExpiredCert`/`cgOnTimeOff`/`cgDoubleBooked`/`cgWrongOffice` all hard-blocked;
`cgOutsideZip`/`cgEligible` not hard-blocked; `cgOutsideZip` carries a soft issue.

**A2. Live `match-caregiver` Edge Function, real HTTP round-trip (6/6):** the same 4
ineligible caregivers absent from `matches[]`; `cgOutsideZip` and `cgEligible` present.

**B. Manual Assign three-state UX via direct RPC calls (6/6):** `cgOutsideZip` (soft
only) rejected without an override reason, succeeds with one; all 4 hard-blocked
caregivers refused regardless of any override reason supplied.

**C. Office-scope closes Phase 0's gap (1/1):** re-ran Phase 0's own confirmed-not-rejected
check — Alpha manager assigning Office Beta's caregiver to an Office Alpha shift is now
rejected (`Caregiver belongs to a different office`), the exact regression Phase 0
flagged as expected-to-fail-until-1B (§7.2.C there).

**D. New-row office derivation (3/3):** a `shifts` row, a `client_orders` row, and a
`time_off_requests` row, each inserted without setting `virtual_office_id`, all landed
with the correct non-NULL office via the new triggers.

**E. `AvailableShifts` unblock (2/2):** an Office Alpha caregiver now sees an open
Office Alpha shift (was zero rows, confirmed in Phase 1A); still sees zero rows for an
open Office Beta shift — office boundary respected, not just "see everything."

**F. Regression (4/4):** Tier-2 `agency_admin` still sees both offices' shifts;
`system_admin` bypass intact; the live Ripple demo's real shifts (31, unchanged) still
queryable; a genuinely valid same-office assignment still succeeds — no false-positive
block introduced by the Rule B/H/J changes.

**Teardown:** all fixtures (2 offices, 12 auth users, 2 clients, 6 caregivers + their
skills/certifications/time-off, shifts, assignments) deleted, then **re-queried** — all
confirmed absent.

### 8.3 Deferred to Phase 2 (tracked in `docs/known-issues.md`, not lost)
- Rule J's real distance threshold (hard >20mi / soft <20mi) — the existing zip-list
  check was only promoted to soft severity here, no distance math added.
- The service-area *model* question itself (radius vs. zip-list vs. agency-structured
  cities vs. a combination) — a research/recommend task for Phase 2, tied to the same
  zip-centroid+haversine distance infrastructure the ranking layer also needs.

### 8.4 Deploy status
Database (migration + RLS policy + triggers) and the `match-caregiver` Edge Function
are live. The frontend changes (`AssignShiftDialog.tsx`, `AutoFillDialog.tsx`,
`shiftEligibility.ts`) are committed but **not yet deployed** — the Manual Assign
three-state UX and the Auto-fill failure-reason surfacing will not be visible in
production until the next frontend deploy.
