# Caregiver Available Shifts / Trade Board Redesign — PLAN (not built)

**Revision 2 — replaces the merged-list design with two separate sections, per your
correction.** The merge (rev 1) folded two genuinely different backend mechanisms behind a
single branching pickup button — the branch itself was the bug risk. This revision instead
presents the two mechanisms honestly as two sections, each with its own single-purpose
button and its own backend path. Net effect: **less new backend surface than rev 1, not
more** — flagged inline below everywhere it simplifies.

Scope: two stacked sections on the caregiver's "Available Shifts" page (Trade Shifts on
top, Open Shifts below), a small "My Trade Requests" status area, and the `/shift-trades`
route-security fix. Still a design doc — nothing here is built.

## 0. Findings carried over from rev 1 (unchanged, still load-bearing)

**0.1 Confirmed against live data:** a pending trade-board row's underlying `shifts.status`
is `'confirmed'`, not `'open'`/`'unassigned'` — the shift stays assigned to the caregiver
trying to give it up; the separate `shift_trades` row (status `'pending'`) is what
advertises it. This is *why* two sections are the honest design, not a limitation to work
around.

**0.2 Two different pick-up code paths exist today, and this revision widens (not
narrows) their difference — see §2 for the new open-shift behavior change:**
- Open shift → `pickUpShift()` → `caregiver_pick_up_shift()` RPC.
- Trade shift → `assignShift()` (method `'traded'`) + a `shift_trades` row update; soft-only
  can escalate to a manager (`ShiftTrades.tsx`'s existing `completeTrade()` logic).

**0.3 Caregivers currently have live, unrestricted access to the whole agency Trade Board**
via a stale `role_permissions` row (`caregiver`/`shift_trades`/`can_read: true`) **and**
`/shift-trades` (`App.tsx:67`) has **no route guard at all** — any authenticated user sees
every tab, including agency-wide approval/history. Menu removal alone does not close this;
still needs the route guard in §5. Unchanged from rev 1.

**0.4 The caregiver's `can_create` grant on `shift_trades` is unused today** — no
caregiver-facing "give up my shift" UI exists anywhere in the codebase; the only
`shift_trades` INSERT is staff-side (`TimeOffDecisionDialog.tsx`, on time-off approval).
Unchanged from rev 1 — still means removing caregiver `shift_trades` permissions regresses
nothing live.

**0.5 `shift_trades`' own RLS is agency-wide, not office-scoped** (no `virtual_office_id`
on the table; its policies join through `original_caregiver_id`'s agency only). The Trade
Shifts section's own query must office-scope itself rather than trust that RLS alone.
Unchanged from rev 1.

## 1. Data model: two sections, two independent sources — SIMPLER than the merge

**Open Shifts section — no new backend needed at all.** This is the first real
simplification: Phase 1B already added a correctly office-scoped `SELECT` RLS policy on
`shifts` for caregivers viewing `open`/`unassigned` rows in their own office. The existing
direct query (`AvailableShifts.tsx`'s current `.from("shifts").select("*").eq("status",
"open")...`, already updated in the pending client-visibility fix to merge in
`get_caregiver_visible_clients()`) is exactly right for this section, unchanged. Nothing
new to build here beyond what's already drafted and awaiting your push approval.

**Trade Shifts section — one new function, not the four-way UNION rev 1 needed.** Rev 1's
`get_caregiver_available_board()` had to UNION two sources into one normalized shape with a
discriminator column, which is exactly the complexity that produced the branching-button
problem. With two sections, the trade side only needs its own query:

```
get_caregiver_trade_shifts()
  -> caregiver's own row resolved from auth.uid() internally, same pattern as
     get_caregiver_visible_clients()
  -> shift_trades WHERE status = 'pending' AND requires_manager_approval = false
     JOIN shifts (the underlying shift) WHERE that shift's agency/office match the
     caller's (closes the §0.5 gap for this section)
  -> returns: shift_trades.id, shift_id, client_id, shift_date/start_time/end_time/
     duration_hours/care_type_code (from the joined shift), original_caregiver first/last
     name, trade.reason
  -> client info still not embedded -- merge fetchCaregiverVisibleClients() in client-side,
     same as the open-shifts section, so both sections share one client-info fetch
```

No `source` discriminator, no UNION, no case-by-case row shape — every row this function
returns is a trade, full stop. `AvailableShifts.tsx` renders it as its own section with its
own card component, distinct from the open-shifts cards.

**Eligibility RPC — unchanged from rev 1, still needed, still shared by both sections.**
The "one caregiver vs. many shifts" transpose of Phase 1B's bulk RPC:
```
check_caregiver_shifts_eligibility(_shift_ids uuid[])
  -> caller resolved from auth.uid() internally (no caregiver_id param)
  -> RETURNS TABLE(shift_id uuid, result jsonb)
```
Call it once with the combined shift ids from both sections (cheap, one round trip), then
look results up per section by `shift_id`. This part doesn't change between rev 1 and rev
2 — the simplification is entirely in §1's data-fetching, not in eligibility.

## 2. Eligibility display — per section, and one real behavior decision to confirm

**Show every row in each section; never silently filter.** Unchanged principle from rev 1.

**Open Shifts — DESIGN CHANGE from rev 1, please confirm before I build it.** You framed
open-shift pickup as self-consent: a caregiver volunteering for their own shift should not
be blocked by a *soft* issue the same way a manager assigning them would be. Today,
`caregiver_pick_up_shift()` rejects on **any** hard **or** soft issue:
```sql
IF jsonb_array_length(elig->'hard') > 0 OR jsonb_array_length(elig->'soft') > 0 THEN
  RAISE EXCEPTION 'Pick-up refused: %', ...
```
Self-consent-allows-soft means this becomes hard-only:
```sql
IF jsonb_array_length(elig->'hard') > 0 THEN
  RAISE EXCEPTION 'Pick-up refused: %', ...
```
**This is a real change to a `SECURITY DEFINER` function's enforcement, not just a UI
change** — flagging explicitly rather than folding it in quietly. Display-wise: hard → **Not
eligible**, disabled, reasons shown; soft-only → **Eligible** (pickup enabled), with the
soft issues shown as an FYI note, not a blocker; clean → **Eligible**, no note.

**Trade Shifts — unchanged three-state from rev 1** (this section's mechanism already has
manager escalation built in, so it doesn't need the same self-consent argument):
- hard=0, soft=0 → **Eligible** → "Pick up trade" (immediate).
- hard=0, soft>0 → **Needs approval** → "Request pickup" (existing `completeTrade()`
  escalation, relocated, not changed).
- hard>0 → **Not eligible** → disabled, reasons shown.

**Per-section sorting:** eligible-now first, then (Trade Shifts only) needs-approval, then
not-eligible — same reasoning as rev 1, just applied within each section independently
instead of across one merged list.

## 3. "My Trade Requests" — caregiver's own outgoing drops

Small status area (own section, likely collapsed/summary by default given it's usually
empty) showing the caregiver's own `shift_trades` rows as `original_caregiver_id`, any
status, read-only. **No new backend needed** — `shift_trades`' existing "Agency staff can
view shift trades" policy already permits reading rows in the caller's own agency; a query
filtered to `WHERE original_caregiver_id = <my caregiver id>` is safely within what that
grants regardless of the agency-wide-not-office-scoped looseness noted in §0.5, because the
caregiver is only ever asking for their *own* rows. Fields: shift date/time, status
(pending/accepted/declined/cancelled/expired), and — once accepted — who picked it up.

Placement: third stacked section on the same "Available Shifts" page, below Open Shifts.
Keeping all three caregiver-facing shift concerns on one page avoids scattering state
across pages, and this section will usually be empty or one row, so it won't compete for
attention with the two actionable sections above it.

## 4. Layout

Stacked sections, single page, in this order: **Trade Shifts** (top — time-sensitive,
someone's actively trying to give this up), **Open Shifts** (middle), **My Trade Requests**
(bottom — status-only, lowest urgency). Each with a clear header and its own empty-state
message. Not tabs — agreed, a single office's lists are short enough that seeing everything
at once beats clicking between tabs, and it makes the "these are two different mechanisms"
distinction visible by construction rather than hidden behind a tab click.

## 5. Menu / route security fix — unchanged from rev 1

**`role_permissions`:** delete (or zero out) the `caregiver` row on module `shift_trades`
(§0.4 confirms nothing live depends on it).

**Route guard (the actual security fix):** add an explicit permission/role check at the top
of `ShiftTrades.tsx`, redirecting a caregiver to `/available-shifts` instead of rendering
the full agency board. This is the real access-control fix — the menu change alone doesn't
stop direct-URL access.

**Staff-facing Trade Board is completely untouched** — same page, same tabs, same
agency-wide view, same override capability, for `manager`/`agency_admin`/`scheduler`/
`system_admin`.

## 6. What got simpler in this revision (as asked)

- **No UNION query, no `source` discriminator, no shared row shape across two different
  data models.** The Open Shifts section needs zero new backend — it's the existing,
  already-correct Phase 1B query.
- **No branching pickup button.** Each section's button calls exactly one function, always.
  Rev 1's action table (source × eligibility × which-function-to-call) collapses into two
  independent, much shorter per-section rules.
- **One fewer new database object.** Rev 1 needed a merge function reaching into both
  `shifts` and `shift_trades`; rev 2's `get_caregiver_trade_shifts()` only reaches into
  `shift_trades` (joined to `shifts` for display fields, not for unioning identities).
- The eligibility RPC, the menu/route fix, and the office-scoping concern (§0.5) are
  unchanged — those were already the minimal necessary pieces, not something the merge
  design added.

## 7. Explicitly NOT part of this plan (unchanged from rev 1)

- Not touching `shift_trades`' own RLS office-scoping gap (§0.5) — logged separately in
  `known-issues.md`.
- Not changing the manager/staff Trade Board UI, tabs, or approval workflow.
- Not touching the systemic date-parsing bug — its own scoped follow-up.
- Not building any of this yet.

## 8. Open questions before I'd build this

1. **Confirm the `caregiver_pick_up_shift()` soft-issue behavior change in §2** — this is
   the one place this revision changes enforcement, not just UI, and it applies to *every*
   caregiver self-pickup going forward, not just this redesign's new sections.
2. Same as rev 1: confirm the `/shift-trades` redirect target (`/available-shifts`
   proposed) for a caregiver hitting it directly.
3. "My Trade Requests" — collapsed-by-default acceptable, or should it always show
   expanded even when empty (a persistent "no active trade requests" line) so a caregiver
   knows the feature exists before they ever use it?

---

## 9. Closure Record (2026-09-16) — CLOSED

All three open questions from §8 answered and built: `caregiver_pick_up_shift()` is
hard-only (confirmed effect: lets a caregiver self-pick a shift outside their declared
availability or up to 20mi outside their service area -- their own volunteering,
self-consented); `/shift-trades` redirects a caregiver to `/available-shifts`; "My Trade
Requests" always shows, even empty ("No active trade requests.").

### 9.1 Bug found by this plan's own test, before ship

Testing the Trade Shifts section's pickup button surfaced a real, pre-existing gap:
`assign_caregiver_to_shift()` requires `is_agency_staff(auth.uid())`, and `caregiver` has
never been in that role's allowed list. A genuine caregiver account has never been able to
complete a trade pickup through it -- this affected the new Trade Shifts section AND the
existing `ShiftTrades.tsx` "Pick up" button (moot for caregivers now that the route guard
removes them from that page, but the underlying gap was real and had gone unnoticed).

**Fix (your decision, Option 2):** a dedicated `caregiver_pickup_trade_shift(_trade_id)`
RPC, self-scoped from `auth.uid()` (no `caregiver_id` parameter), mirroring
`caregiver_pick_up_shift()`'s existing pattern rather than relaxing
`assign_caregiver_to_shift()`'s staff-only auth surface. Does its own hard/soft handling
(hard refuses, soft escalates to a manager -- same semantics as the existing trade flow),
its own office-scope check (matching `get_caregiver_trade_shifts()`'s read-time scoping),
and reassigns the shift's existing `shift_assignments` row rather than inserting a
duplicate. **Race-safety addition beyond the original design:** the trade row is claimed
via `UPDATE ... WHERE status = 'pending'` *before* `shift_assignments` is touched, in both
the soft-escalation and clean-success branches -- a losing concurrent caller's claim
affects zero rows and the function aborts cleanly before ever mutating the assignment.

### 9.2 Two migrations for this redesign

1. `20260916180000_caregiver_board_redesign.sql` -- `get_caregiver_trade_shifts()`,
   `check_caregiver_shifts_eligibility()`, the `caregiver_pick_up_shift()` hard-only
   change, the `role_permissions` deletion.
2. `20260916210000_caregiver_pickup_trade_shift.sql` -- the bug fix from §9.1.

(The client-visibility fix, `20260916120000_caregiver_visible_client_info.sql`, is a
separate concern committed separately -- see commit `0898363`.)

### 9.3 Test matrix -- 16/16 passed on the final run (two earlier runs caught test-script bugs, not product bugs, detailed below for the record)

- Caregiver **can now** complete a trade pickup via the new RPC (the §9.1 bug, fixed).
- Reassignment correctness: the existing `shift_assignments` row is updated (not
  duplicated), `shift_trades` marked `accepted`/`auto_approved` with `new_caregiver_id` set.
- A caregiver cannot pick up their own drop request.
- An already-resolved trade is refused to a different caregiver.
- Soft-only escalates (`sent_for_approval`, `requires_manager_approval=true`,
  `shift_assignments` NOT yet reassigned) -- does not silently succeed.
- Hard-fail still refused, trade row left untouched.
- Office-scope check present and enforced.
- Staff `assign_caregiver_to_shift` path completely unaffected (still hard-blocks,
  confirmed live, function untouched by any of this work).
- **Concurrent-claim race, genuine two-connection test:** exactly one of two simultaneous
  callers on the same trade succeeds; the loser gets a clean "no longer available"
  rejection; exactly one `shift_assignments` row exists afterward, assigned to the actual
  winner -- no corrupted or duplicate state.

**Two test-script bugs caught and fixed during this pass, not product bugs** (both
instructive): (1) an early "Open Shifts still shows it" assertion checked a shift that an
earlier assertion in the *same test* had legitimately just picked up -- fixed by using a
dedicated untouched fixture for that check. (2) the race test's own date arithmetic used
`d.toISOString().slice(0,10)`, which shifts across the UTC boundary and silently rolled the
intended "Monday" to a different weekday in Postgres's own day-of-week calculation --
exactly the systemic date-parsing bug class already logged in `known-issues.md`, caught
here in test code rather than product code. Fixed by building the date string from local
date parts instead.

### 9.4 Deploy status

DB migrations are live (this redesign's three, plus the separately-committed
client-visibility fix's one). Frontend changes are committed but need a frontend deploy
before caregivers see the new three-section page, the route guard, or the client-visibility
fix in production.
