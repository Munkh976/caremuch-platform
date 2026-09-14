# Smart Scheduling Phase 0 — Office-Scope the Operational Scheduling Tables

> **Status: PLAN ONLY. Nothing applied.** Mirrors M1/M-Office discipline exactly:
> live-policy reads via a fresh read-only Postgres connection (`SELECT`-only, not
> reused across sessions), the identical fail-closed `office_restricted` mechanism
> reused (not reinvented), additive-`AND` RLS preserving every existing agency clause,
> a two-office isolation test as the actual done-definition. STOP for review before
> any implementation.

## 0. What was verified live (not assumed from the plan docs)

Confirmed directly against the database, not inferred from `CareMuch_Smart_Scheduling_Consolidated_Plan.md` or `m-office-scoping-plan.md` §8.4's claim:

- **None of `shifts`, `shift_assignments`, `client_orders`, `time_entries`,
  `time_off_requests` have a `virtual_office_id` column** — confirmed via
  `information_schema.columns`.
- **Current RLS on all five is agency-scoped only**, exact live text captured below
  (§1) — not reconstructed from migration history.
- **The derived-caregiver mechanism**, in full:
  - `shifts.caregiver_id` has `trg_enforce_derived_shift_caregiver` — `BEFORE INSERT
    OR UPDATE OF caregiver_id` (column-scoped, so it does **not** fire on an `UPDATE`
    that only touches `virtual_office_id` — confirmed safe for the backfill in §3).
  - `shift_assignments` has three triggers: `trg_protect_assignment_columns`
    (**blocks direct `INSERT`** into `shift_assignments` entirely — "use
    `assign_caregiver_to_shift()`" — unless `caremuch.assignment_ctx` is set, which
    only that RPC and `caregiver_pick_up_shift()` set internally; also blocks
    changing `caregiver_id`/override fields directly, and blocks cancelling by
    direct `UPDATE`), `trg_protect_completed_assignment` (`BEFORE DELETE`, blocks
    deleting a `completed` assignment except under a purge context), and
    `trg_sync_shift_caregiver` (`AFTER INSERT OR DELETE OR UPDATE`, recomputes
    `shifts.caregiver_id`/`status` from the assignment set via
    `derived_shift_caregiver()`).
  - `shifts` also has `trg_event_shift` (`AFTER INSERT OR UPDATE`) — logs an event
    only on `INSERT` or a `status` transition to `completed`/`cancelled`; **does
    nothing on an `UPDATE` that only changes `virtual_office_id`** (confirmed by
    reading the function body — no event, no side effect), and
    `update_shifts_updated_at` (bumps `updated_at`, harmless).
  - **Practical consequence for the two-office test (§5):** a test `shift_assignments`
    fixture **cannot** be created via a raw `service_role` insert — it must go
    through `assign_caregiver_to_shift()` (or `caregiver_pick_up_shift()`), which
    conveniently makes the test also a live regression check on that RPC, not an
    extra step.
- **Backfill feasibility, checked row-by-row, not assumed:** every row in all five
  tables resolves to a non-NULL office through its natural join, with zero orphans:

  | Table | Rows | Join path checked | Result |
  |---|---|---|---|
  | `shifts` | 31 | `client_id → clients.virtual_office_id` | 0 would stay NULL |
  | `client_orders` | 8 | `client_id → clients.virtual_office_id` | 0 would stay NULL |
  | `time_entries` | 8 | both `shift_id → shifts→client` and `caregiver_id → caregivers` checked | **identical result either way** — all 8 resolve to the same office via both paths (see §2 for which is still recommended, and why) |
  | `time_off_requests` | 1 | `caregiver_id → caregivers.virtual_office_id` | resolves |
  | `shift_assignments` | 15 | (no column planned — helper via `shift_id`) | all 15 reference a valid shift (0 orphaned) |

  Every resolved office is Ripple Effects (`12faa863-…`) — consistent with M-Office's
  own finding that Kind Care has zero real records currently.

---

## 1. Current live RLS (exact text, for the diff basis in §4)

**`shifts`** (3 policies):
- `"Agency staff manage shifts in their agency"` (ALL): `is_agency_staff(auth.uid())
  AND agency_id = current_agency_id()`
- `"Caregivers read their own assigned shifts"` (SELECT): `is_my_assigned_shift(id)`
  — **untouched**, no office gate needed (a caregiver's own assigned shift).
- `"Clients read their own shifts"` (SELECT): `client_id IN (my_client_ids())` —
  **untouched**, same reasoning.

**`shift_assignments`** (3 policies, confirmed — no INSERT/DELETE policy for
`authenticated` at all, RPC-only, per M1's own finding):
- `"Agency staff read assignments in their agency"` (SELECT):
  `is_agency_staff(auth.uid()) AND shift_assignment_agency_id(shift_id) =
  current_agency_id()`
- `"Agency staff update operational fields"` (UPDATE): same shape.
- `"Caregivers read their own assignments"` (SELECT): `caregiver_id IN
  (my_caregiver_ids())` — **untouched**.

**`client_orders`** (2 policies):
- `"Agency staff manage care plans in their agency"` (ALL): `is_agency_staff(auth.uid())
  AND agency_id = current_agency_id()`
- `"Clients read their own care plans"` (SELECT): `client_id IN (my_client_ids())` —
  **untouched**.

**`time_entries`** (4 policies):
- `"time_entries_staff_manage"` (ALL): `is_agency_staff(auth.uid()) AND (agency_id =
  current_agency_id() OR has_role(system_admin))`
- Three caregiver-self policies (`_caregiver_insert_own`/`_read_own`/`_update_own`)
  — **untouched**, all scoped to `caregiver_id IN (my_caregiver_ids())`.

**`time_off_requests`** (4 policies):
- `"Agency managers decide time off in their agency"` (UPDATE): `(manager OR
  agency_admin OR system_admin role) AND agency_id = current_agency_id()`
- `"Agency staff view time off in their agency"` (SELECT): `is_agency_staff(auth.uid())
  AND agency_id = current_agency_id()`
- Two caregiver-self policies (`create`/`view own`) — **untouched**, scoped to
  `caregiver_id IN (SELECT id FROM caregivers WHERE user_id = auth.uid())`.

Every policy above marked "untouched" stays exactly as-is — this phase only adds the
office clause to the **staff-wide** policies, never the self-access ones, matching
M-Office's own discipline.

---

## 2. Column vs. helper — per table, with reasoning

| Table | Design | Reasoning |
|---|---|---|
| `shifts` | **New column**, direct | Denormalized, same precedent as `agency_id` already living directly on `shifts` rather than only derived via `client_id`. Backfill: `client_id → clients.virtual_office_id` (confirmed product decision, M-Office §6: an office serves clients). |
| `client_orders` | **New column**, direct | Same reasoning as `shifts` — an order belongs to a client, backfill `client_id → clients.virtual_office_id`. |
| `shift_assignments` | **Helper, no column** | Matches its existing `agency_id`-via-`shift_id` pattern exactly (`shift_assignment_agency_id()`). New `shift_assignment_virtual_office_id(_shift_id uuid)` mirrors it one-for-one — a one-line `SELECT virtual_office_id FROM shifts WHERE id = _shift_id`. No new column, no backfill needed (it's always derived from the shift it belongs to). |
| `time_entries` | **New column**, direct, backfilled via **`shift_id`** (not `caregiver_id`) | Empirically both join paths give the identical answer today (§0), so this is a genuine design choice, not forced by the data. Recommending `shift_id → shifts.virtual_office_id`: a time entry is fundamentally "the record of work done on *this shift*," and `shifts.virtual_office_id` is itself already authoritative (client-side). Deriving from the shift keeps `time_entries` consistent with the shift it's for even in a hypothetical future where a caregiver could be assigned across offices — deriving from `caregiver_id` instead would silently disagree with the shift's own office in that case. `time_entries.shift_id` is already `NOT NULL`, so this join is always available. |
| `time_off_requests` | **New column**, direct, backfilled via **`caregiver_id`** | Structurally different from the other four — there is no shift or client involved at all in a time-off request. It is caregiver-centric by nature, so `caregiver_id → caregivers.virtual_office_id` is the only sensible derivation. Flagging explicitly since it's the one table in this batch that doesn't follow the "client-side" rule the other four do. |

---

## 3. Migration design (mirrors M-Office §3a exactly — additive `AND`, reuse the existing helpers)

```sql
-- New helper, mirrors shift_assignment_agency_id() exactly
CREATE OR REPLACE FUNCTION public.shift_assignment_virtual_office_id(_shift_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT virtual_office_id FROM public.shifts WHERE id = _shift_id
$$;

-- shifts
ALTER TABLE public.shifts
  ADD COLUMN virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL;

UPDATE public.shifts s
SET virtual_office_id = c.virtual_office_id
FROM public.clients c
WHERE s.client_id = c.id AND s.virtual_office_id IS NULL;

DROP POLICY "Agency staff manage shifts in their agency" ON public.shifts;
CREATE POLICY "Agency staff manage shifts in their agency"
ON public.shifts FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (
  is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
);

-- client_orders (identical shape)
ALTER TABLE public.client_orders
  ADD COLUMN virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL;

UPDATE public.client_orders o
SET virtual_office_id = c.virtual_office_id
FROM public.clients c
WHERE o.client_id = c.id AND o.virtual_office_id IS NULL;

DROP POLICY "Agency staff manage care plans in their agency" ON public.client_orders;
CREATE POLICY "Agency staff manage care plans in their agency"
ON public.client_orders FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (same);

-- shift_assignments (helper-based, no column, no backfill)
DROP POLICY "Agency staff read assignments in their agency" ON public.shift_assignments;
CREATE POLICY "Agency staff read assignments in their agency"
ON public.shift_assignments FOR SELECT TO authenticated
USING (
  is_agency_staff(auth.uid()) AND shift_assignment_agency_id(shift_id) = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR shift_assignment_virtual_office_id(shift_id) = current_virtual_office_id())
);

DROP POLICY "Agency staff update operational fields" ON public.shift_assignments;
CREATE POLICY "Agency staff update operational fields"
ON public.shift_assignments FOR UPDATE TO authenticated
USING (
  is_agency_staff(auth.uid()) AND shift_assignment_agency_id(shift_id) = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR shift_assignment_virtual_office_id(shift_id) = current_virtual_office_id())
)
WITH CHECK (same);

-- time_entries
ALTER TABLE public.time_entries
  ADD COLUMN virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL;

UPDATE public.time_entries te
SET virtual_office_id = s.virtual_office_id
FROM public.shifts s
WHERE te.shift_id = s.id AND te.virtual_office_id IS NULL;

DROP POLICY "time_entries_staff_manage" ON public.time_entries;
CREATE POLICY "time_entries_staff_manage"
ON public.time_entries FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid()) AND (agency_id = current_agency_id() OR has_role(auth.uid(),'system_admin'))
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (same);

-- time_off_requests
ALTER TABLE public.time_off_requests
  ADD COLUMN virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL;

UPDATE public.time_off_requests t
SET virtual_office_id = cg.virtual_office_id
FROM public.caregivers cg
WHERE t.caregiver_id = cg.id AND t.virtual_office_id IS NULL;

DROP POLICY "Agency managers decide time off in their agency" ON public.time_off_requests;
CREATE POLICY "Agency managers decide time off in their agency"
ON public.time_off_requests FOR UPDATE TO authenticated
USING (
  (has_role(auth.uid(),'manager') OR has_role(auth.uid(),'agency_admin') OR has_role(auth.uid(),'system_admin'))
  AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (same);

DROP POLICY "Agency staff view time off in their agency" ON public.time_off_requests;
CREATE POLICY "Agency staff view time off in their agency"
ON public.time_off_requests FOR SELECT TO authenticated
USING (
  is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
);
```

**No RPC signatures change in this migration** — `assign_caregiver_to_shift()`,
`check_assignment_eligibility()`, `caregiver_pick_up_shift()`, and the derived-caregiver
trigger functions are all untouched. The CLAUDE.md rule #13 / known-issues.md FOOTGUN
(`CREATE OR REPLACE FUNCTION` creating a stale overload) **does not apply here** — this
is flagged explicitly because the brief called it out, and it's worth confirming in
writing that the reason it doesn't apply is "no signature changes," not "forgotten."

**Side effects of the backfill `UPDATE`s, checked, not assumed:** `update_shifts_updated_at`
bumps `updated_at` on all 31 backfilled shift rows (harmless, expected for any `UPDATE`).
`trg_event_shift` fires on the `shifts` backfill `UPDATE` but its body only acts on an
`INSERT` or a `status` transition to `completed`/`cancelled` — neither is true here, so
it's a no-op, confirmed by reading the function body, not assumed.

---

## 4. Two-Office Isolation Test Design

Same method as M1/M-Office: real `auth.admin.createUser` accounts, real
`signInWithPassword` JWTs, real RLS through PostgREST, disposable fixtures under the
real Agency A, teardown verified by re-query.

1. **Two disposable offices** under Agency A (`56fbfe38`), not the real Ripple/Kind
   Care/Primary Office rows. Bootstrap one Tier-3 manager per office
   (`office_restricted=true`), one Tier-2 agency_admin (`office_restricted=false`),
   one system_admin — identical fixture shape to M-Office's own test, reused.
2. **Fail-open re-proof**: attempt the same dangerous write M-Office already proved
   impossible (`office_restricted=true` + NULL `virtual_office_id`, both as `INSERT`
   and `UPDATE`) — must still be rejected by `profiles_office_restricted_requires_office`.
   This isn't re-testing new code (the constraint is unchanged), it's confirming
   Phase 0's changes don't somehow create a new path around it.
3. **Fixture data per office**: one disposable client, one disposable caregiver, one
   disposable shift (referencing that office's client — `virtual_office_id` set via
   the same client-side backfill logic, or explicitly since these are new rows), one
   `client_orders` row, one `time_entries` row, one `time_off_requests` row. **The
   `shift_assignments` fixture must be created by calling `assign_caregiver_to_shift()`
   as the office's own Tier-3 manager** (not a raw insert — blocked by
   `trg_protect_assignment_columns`, per §0) — this is both the fixture setup *and*
   the RPC regression check in one step.
4. **Isolation** (Office A manager → Office B data): cannot `SELECT` Office B's
   shift/order/time_entry/time_off_request/shift_assignment; cannot `UPDATE` them
   (service-role recheck after each attempt, not just the response). Can `SELECT`
   Office A's own (sanity).
5. **Regression — Tier-2 sees both**: the agency_admin fixture reads/writes both
   offices' shifts/orders/time_entries/time_off_requests/assignments successfully.
6. **Regression — the derived-caregiver mechanism**: after step 3's
   `assign_caregiver_to_shift()` call, confirm (service-role read) that
   `shifts.caregiver_id` was correctly derived to match the assignment, and that
   `shifts.status` flipped to `'assigned'` — proves `trg_sync_shift_caregiver`/
   `derived_shift_caregiver()` still function correctly post-RLS-change. Also attempt
   a direct `UPDATE shifts SET caregiver_id = ...` as service role — must still be
   silently overwritten back to the derived value on the next read (or rejected,
   depending on exact trigger timing) — confirms the derived-column contract isn't
   accidentally weakened.
7. **Regression — live Ripple demo**: as a real (or equivalently-scoped throwaway)
   Ripple-office-scoped account, confirm the real 31 shifts / 15 assignments / 8
   orders / 8 time entries / 1 time-off request remain fully visible and unaffected —
   same frozen-demo check every prior phase ran.
8. **system_admin bypass**: sees both test offices' everything.
9. **Teardown**: delete `shift_assignments` fixtures first (their `status` is
   `'scheduled'`, not `'completed'`, so `trg_protect_completed_assignment` does not
   block the delete), then shifts/orders/time_entries/time_off_requests/
   clients/caregivers/offices/users, then **re-query every one** to confirm absence —
   not trusting delete responses, identical discipline to M1/M-Office.

Only once this passes is Phase 0 considered proven — Phase 1A (the audit) should not
start before this, same gate M1 set for M-Office and M-Office set for this phase.

---

## 5. Flagged Decisions

1. **`time_off_requests`: office-scope it, don't leave it agency-wide.** M-Office left
   some secondary tables (`pending_notifications`/`earnings_lines`/`shift_ratings`/
   `events`) agency-wide, reasoning that Tier-3 office-scoping wasn't required to prove
   the mechanism there. `time_off_requests` is different: the Smart Scheduling plan's
   own Rule H (approved time-off is a **hard** eligibility rule) means the eligibility
   engine will need to check a caregiver's time-off status *within an office-scoped
   query context* the moment Phase 1B is built. Leaving it agency-wide now would mean
   redoing this exact migration later. Recommend office-scoping it in this phase,
   alongside the other four — flagging as a decision rather than assuming, since it's
   a deliberate reversal of M-Office's "secondary tables stay agency-wide" default.
2. **`client_orders`: office-scope it (not deferred).** Same reasoning — `shifts.order_id`
   references it directly, and a Tier-3 manager scheduling within their office needs to
   see that office's orders. Including it in Phase 0 rather than treating it as a
   "secondary table" like M-Office's `pending_notifications`.
3. **`time_entries`'s derivation path (`shift_id` vs `caregiver_id`)** — resolved in §2
   with reasoning; flagging again here since it's a real design choice, not forced by
   current data (both paths agree today, per §0's table).
4. **No new RPC signatures in this migration** — confirmed the FOOTGUN doesn't apply
   here (§3), but noting it was checked, not skipped.

## 6. What This Plan Deliberately Does Not Do

Apply any schema/RLS/data change. Touch `check_assignment_eligibility()`,
`assign_caregiver_to_shift()`, or any derived-caregiver trigger function (Phase 1B's
eligibility-engine work adds Rule B using these new columns — that's the *next* phase,
not this one). Office-scope `earnings_lines`/`shift_ratings`/`pending_notifications`/
`events` (unchanged from M-Office's own deferral — not revisited here). Begin Phase 1A's
audit.

**Next step, on your approval:** write the §3 migration for review (shown before push,
same as M1/M-Office), apply it, run the §4 two-office test, then Phase 1A begins.

---

## 7. Closure Record (2026-09-14)

### 7.1 Migration applied (one, after one same-day ordering fix)
`supabase/migrations/20260914041040_scheduling_phase0_office_scoping.sql` — exactly
§3's design. First push failed cleanly (transactional rollback, confirmed via direct
re-query before any fix) on `column "virtual_office_id" does not exist` — the
`shift_assignment_virtual_office_id()` helper is `LANGUAGE sql`, and unlike `plpgsql`,
`sql`-language function bodies are validated against the schema **at `CREATE` time**,
not first-call time. It was originally placed before `shifts` gained the column it
references. Fixed by moving the `shifts` `ALTER TABLE ADD COLUMN` immediately before
the helper's definition (backfill/RLS for `shifts` follow, unchanged); re-pushed
successfully, re-verified via direct query (all 4 columns present and nullable, the
helper function exists with a single correct signature, zero `NULL` rows remain in
any of the four backfilled tables, all 7 policies reference `is_office_restricted`)
before testing began.

### 7.2 Two-office isolation test — 22/22 passed (+ 4 informational notes)

Same method as M1/M-Office: real `auth.admin.createUser` accounts, real
`signInWithPassword` JWTs, real RLS through PostgREST, disposable fixtures under the
real Agency A, teardown verified by re-query.

**A. Fail-open re-proof (1/1):** the unchanged `profiles_office_restricted_requires_office`
constraint still rejects `office_restricted=true` + NULL office post-Phase-0.

**B. Isolation, Office Alpha manager → Office Beta data (9/9):** cannot `SELECT`/`UPDATE`
Beta's shift, order, or time-off request (`UPDATE` attempts rechecked via service-role
read, not just the response); *can* `SELECT` each of Alpha's own (sanity, all 3).

**C. RPC assignment regression (4/4, + 1 note):**
| Check | Result |
|---|---|
| `assign_caregiver_to_shift()` same-office assignment | succeeds, `eligible:true` |
| Derived-caregiver trigger post-column-add | `shifts.caregiver_id` correctly derived, `status` → `assigned` |
| Alpha manager `SELECT`/isolation on the resulting `time_entries` row | own visible, Beta's not |
| **Cross-office assignment attempt** | **NOT rejected** — empirically confirmed, not assumed. Alpha's manager successfully assigned Office Beta's caregiver to Office Beta's shift. **This is expected, not a Phase 0 regression**: `assign_caregiver_to_shift()`/`check_assignment_eligibility()` are untouched by Phase 0 (confirmed — no office/Rule-B check exists in either body); enforcing office scope inside the RPC is explicitly Rule B, Phase 1B's job per the Consolidated Plan itself. Phase 0 only closes direct-table RLS access to `shifts`/`shift_assignments`/etc., which it does. |

**D. Regression, Tier-2 agency_admin (4/4):** sees both offices' shifts, orders,
time-off requests, and shift_assignments.

**E. Regression, live Ripple demo (2/2):** all 31 real (non-test) shifts under Agency A
still present; Ripple-office-scoped shifts still readable by agency-wide staff.

**F. system_admin bypass (2/2):** sees both offices' shifts and both office rows.

**Teardown:** all fixtures (2 offices, 4 users, 2 clients, 2 caregivers + their
`caregiver_skills`, 2 shifts, 2 orders, 2 time_entries, 2 time_off_requests, 2
shift_assignments) deleted, then **re-queried** — all confirmed absent, not inferred
from delete responses.

### 7.3 Finding: no insert-time office population for NEW scheduling rows — flagged for Phase 1A, not fixed here

**Confirmed empirically, not assumed:** Phase 0's migration backfills only the rows
that existed at migration time. It adds **no trigger or other mechanism** to populate
`virtual_office_id` on a *newly inserted* `shifts`/`client_orders`/`time_entries`/
`time_off_requests` row going forward. Proven directly: inserting a throwaway shift
(and separately, a time-off request, and a time_entry) without explicitly setting
`virtual_office_id` landed with it `NULL` in all three cases — confirmed, then deleted
immediately, not used as a real fixture.

**This is the identical class of gap M-Office found and fixed for `create-user`**
("never touches `virtual_office_id` at all," the direct cause of the `clients`/
`caregivers` "unassigned office" symptom) — except here, the equivalent write path
(wherever the app actually creates a `shifts`/`client_orders`/`time_entries`/
`time_off_requests` row today) has not yet been identified or fixed, because that
code lives in the scheduling UI/logic **Phase 1A's own job is to audit** — fixing it
blind, before that audit, risks fixing the wrong call site or duplicating logic
Phase 1A would otherwise consolidate.

**Consequence if left as-is:** any shift/order/time-entry/time-off row created through
the app *after* this migration lands with `virtual_office_id = NULL` — invisible to
any Tier-3 (office-restricted) manager by the fail-closed design (correctly — a NULL
office is treated as "not this manager's," never as "everyone's"), visible only to
Tier-2/system_admin until manually corrected. Not a security gap (fails closed, the
correct direction) — an availability/workflow gap once Tier-3 accounts exist.

**Recommendation, not decided here:** address this explicitly as part of Phase 1A's
audit (which will identify every place scheduling rows are created) rather than
patching it now from outside that audit. Flagging so it's a known, expected finding
when Phase 1A surfaces it — not a surprise.
