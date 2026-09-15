# Smart Scheduling Phase 1A — Audit of Existing Scheduling

> **Status: READ-ONLY AUDIT. No code/schema/data changed.** Component-by-component
> gap report, per the Consolidated Plan's own instruction: "the design exists but
> doesn't work" means there is code to understand first — audit before building.
> STOP for review before any Phase 1B implementation.

## Executive Summary — the actual root cause

**There is one real eligibility engine, and it works.** `check_assignment_eligibility()`
(DB-side, `SECURITY DEFINER`) is authoritative, correctly enforced by
`assign_caregiver_to_shift()`/`caregiver_pick_up_shift()`, and Phase 0's own two-office
test empirically proved it still fires correctly (hard/soft distinction, override
flow, derived-caregiver trigger sync — all confirmed working).

**"Doesn't work" is not an engine problem — it's that two of the four scheduling
surfaces never call the engine before letting a manager act, and one surface's
underlying data is invisible due to an unrelated RLS gap:**

1. **Manual Assign** (`AssignShiftDialog.tsx`) shows the **full roster** of active
   caregivers with zero eligibility filtering — confirmed by reading the query
   directly (`.eq("agency_id", ...).eq("is_active", true)`, nothing else). A manager
   can pick anyone; ineligibility is only discovered *after* confirming, when the
   server-side RPC rejects it.
2. **Smart Assign / Auto-fill** (`match-caregiver` Edge Function) is a **second,
   entirely separate scoring implementation that never calls
   `check_assignment_eligibility()` at all** — confirmed by reading its full body.
   It has no hard filter: a caregiver with an expired certification, approved time
   off overlapping the shift, or an existing double-booking can still appear
   top-ranked with a high score, because none of those are checked, only
   skill/service-area/availability/reliability/performance are *soft-scored*. This
   directly violates the Consolidated Plan's own core rule ("Hard eligibility is a
   FILTER... never collapse these into each other") — it's not a bug in the ranking
   math, it's that the hard-filter layer was never inserted in front of it.
3. **`AvailableShifts.tsx`** (caregiver self-service pick-up) is fully and correctly
   built — search, filters, and a call to the real, eligibility-enforcing
   `caregiver_pick_up_shift()` RPC — but **the underlying RLS on `shifts` has no
   policy granting a caregiver `SELECT` on an open shift not yet theirs**, confirmed
   still true post-Phase-0 (Phase 0 only touched the staff-management policy). This
   is the exact, already-documented `known-issues.md` bug, unaffected by M1/
   M-Office/Phase 0 — the page silently returns zero rows for every caregiver.

**One genuinely good counter-example already exists and should be the model for the
fix, not a new design:** `ShiftTrades.tsx` correctly calls the shared engine twice —
once client-side (`evaluateEligibility()` from `shiftEligibility.ts`, which itself
calls `check_assignment_eligibility()` via RPC) to preview and block the UI action,
and again authoritatively server-side by routing the actual reassignment through
`assignShift()` → `assign_caregiver_to_shift()`. This is "one shared engine, used
everywhere" working exactly as the plan describes — Manual Assign and Smart Assign
just never adopted this pattern.

**Recommendation, in one sentence: fix Manual Assign and Smart Assign to follow the
`ShiftTrades.tsx` pattern (filter/gate via the existing `shiftEligibility.ts` +
`check_assignment_eligibility()`), don't rebuild the engine — it already works.**

---

## 1. `check_assignment_eligibility` — the existing eligibility function

**What it is:** a `STABLE SECURITY DEFINER` PL/pgSQL function,
`check_assignment_eligibility(_shift_id uuid, _caregiver_id uuid) RETURNS jsonb`. Not
an Edge Function, not client-code — pure DB-side, called via `supabase.rpc(...)`.

**Callers, confirmed by reading the code (not assumed):**
- `assign_caregiver_to_shift()` (DB) — calls it, hard rules block outright, soft
  rules require `_override_reason`.
- `caregiver_pick_up_shift()` (DB) — calls it, **no overrides possible** for
  self-service pick-up (both hard and soft block).
- `evaluateEligibility()` in `src/lib/shiftEligibility.ts` (frontend) — calls it via
  RPC for a client-side preview, with a **local reimplementation only as an offline
  fallback** if the RPC is unreachable (explicitly documented in the code's own
  comment). Confirmed used by `ShiftTrades.tsx`. **Confirmed NOT called by
  `AssignShiftDialog.tsx`, `SmartAssignSheet.tsx`, or `AutoFillDialog.tsx`** — this
  is the gap, not the function itself.

**Returns a structured, explainable result** — `{eligible, auto_approvable, hard[],
soft[], advisory[], weekly_hours, projected_weekly_hours}`, each issue an object with
`code`/`label`/`detail`. Matches the Consolidated Plan §6.2's contract shape closely
(hard/soft/advisory maps to failed/overridable/flags). Not a bare boolean.

### Rule coverage matrix (Plan §6.1, A–K)

| Rule | Status in `check_assignment_eligibility` | Notes |
|---|---|---|
| A — Agency scope | ✅ Present (hard) | `cg.agency_id IS DISTINCT FROM s.agency_id` |
| B — Virtual-office scope | ❌ **Missing entirely** | No `virtual_office_id` reference anywhere in the function. Phase 0 added the column to `shifts`/`caregivers` (via M-Office); this function has not been updated to use it. **This is Phase 1B's primary addition.** |
| C — Active status | ✅ Present (hard) | `cg.is_active IS FALSE` |
| D — Role compatibility | ❌ **Missing** | No check against a caregiver "role" vs. a shift's required role anywhere in the function or the `shifts`/`caregivers` schema as read — confirmed no `required_role` column exists on `shifts`. If Rule D is meant to be care-type/skill-based, it's covered by Rule E instead; if a genuine separate "role" concept is intended, it doesn't exist in the schema today and needs a design decision, not just a code fix. |
| E — Required skills | ✅ Present (hard) | Checks `care_type_code` + `required_skills[]` against `caregiver_skills` |
| F — Required certifications (validity) | ✅ Present (hard) | Both expired (`expiry_date < shift_date`) and unverified (`is_verified IS NOT TRUE`) checked |
| G — Availability (full window) | ✅ Present (soft) | Checks `caregiver_availability` + `caregiver_availability_exceptions`, requires full window coverage — but classified as **soft**, not hard, in the current function (a manager can override "outside declared availability") |
| H — Approved time-off | ✅ Present (**soft**, not hard) | `EXISTS (... time_off_requests ... status='approved' ...)` — pushed to `soft`, overridable. Plan §6.1 frames this as a hard rule; current implementation treats it as override-able. Flagging as a design question for Phase 1B, not silently "fixing" it either direction. |
| I — No overlapping assignment | ✅ Present (hard) | `double_booked` check via same-day assignment overlap |
| J — Service area | ⚠️ Present but **advisory only**, not even soft | `service_area` mismatch only adds to `advisory`, never blocks or requires override |
| K — Scheduling flexibility | ❌ **Missing** | No `scheduling_flexibility` field referenced anywhere in `clients`/the function. The Plan's own §6.1 says this needs "the exact operational meaning... defined as an explicit rule before coding" — confirmed nothing has been coded yet, consistent with the plan's own framing. |

**Reading this table:** 6 of 11 rules present as intended (A, C, E, F, I, and G/H present
but at a softer severity than the Plan's letter suggests). D and K are genuinely
absent from the schema, not just the function — building them is real net-new design
work, not a fix. B is the one Phase 0 was explicitly building toward and is the most
mechanical addition (the pattern — `cg.virtual_office_id IS DISTINCT FROM
s.virtual_office_id` — mirrors Rule A exactly).

---

## 2. Smart Assign / Auto-fill — the "doesn't work" centerpiece

**What exists:** `match-caregiver` (Edge Function) — a **deterministic weighted
scorer** (`skillCoverage 40, serviceArea 25, availability 15, reliability 10,
performance 10`), confirmed to have **zero LLM/AI provider dependency** (matches
CLAUDE.md's own note — the "AI" in "AI match" is entirely this scorer, not a model
call). Consumed by two UI surfaces:
- `SmartAssignSheet.tsx` — single-shift, shows ranked candidates with score badges,
  hands the pick to `AssignShiftDialog` pre-filled.
- `AutoFillDialog.tsx` — bulk, calls `match-caregiver` once per unassigned shift,
  takes the single best not-already-used-that-day match, proposes it, and on commit
  calls `assignShift()` (the real RPC) per selected proposal.

**Why it doesn't work — traced directly in the code, not guessed:**

1. **`match-caregiver` never calls `check_assignment_eligibility()`.** It queries
   `caregivers` directly (`.eq('agency_id', shift.agency_id).eq('is_active', true)`)
   and scores every result. Missing skills, expired/unverified certifications,
   approved time off, an existing double-booking on that day, or being in the wrong
   office (Rule B, not yet enforced anywhere) — **none of these exclude a
   candidate.** Only skill/service-area/availability reduce the *score*; certs and
   time-off aren't checked *at all* in this function, not even as a warning.
2. **Consequence for `SmartAssignSheet.tsx`:** a top-ranked "95% match" can still be
   hard-ineligible. The manager doesn't find out until they click "Assign" and
   `AssignShiftDialog` submits to the real RPC, which then rejects it — a confusing
   "the AI recommended someone who can't be assigned" experience, which is very
   likely the literal "doesn't work" symptom being reported.
3. **Consequence for `AutoFillDialog.tsx` is worse and silent:** `commit()` calls
   `assignShift()` per chosen proposal inside a loop; on rejection it does
   `console.error(e); failed++`, then shows a single toast like "Auto-filled 3
   shifts, 5 failed" with **zero detail on why** any of the 5 failed. A manager
   running Auto-fill on a real period could see most proposals silently fail with no
   actionable information — again, likely the literal reported symptom.
4. **Not office-scoped.** `match-caregiver`'s caregiver query filters only by
   `agency_id`; after Phase 0, a shift's candidate pool should be narrowed by
   `virtual_office_id` too (Rule B) but isn't — a Tier-3 manager's Smart Assign would
   surface caregivers from every office in the agency, not just their own.
5. **`AutoFillDialog`'s same-day dedup is date-level, not time-window-level** — it
   only prevents proposing the same caregiver twice on the *same calendar date*
   across the batch, not for genuinely overlapping time windows on different
   caregiver schedules already committed earlier in the run. A secondary
   double-booking risk, smaller than #1–2 but worth fixing alongside them since the
   real RPC's hard `double_booked` rule would catch it anyway at commit time (masked
   by the same silent-failure issue in #3).

**Fix, not rebuild:** the scoring math itself (`WEIGHTS`, the 0–1 factor scoring) is
reasonable and doesn't need to change. What's missing is a hard filter *in front of*
it — call `check_assignment_eligibility()` (or a bulk equivalent) for each candidate
first, exclude anyone with `hard.length > 0`, and only then rank the eligible
remainder. This is exactly Phase 1B/Phase 2's own layering (Eligibility Engine →
Smart Assign Ranking) — `match-caregiver` is really a preview of Phase 2's ranking
layer that shipped without Phase 1B's gate in front of it.

---

## 3. Manual Assign — does it filter, or show the full roster?

**Confirmed: full roster, zero eligibility filtering.** `AssignShiftDialog.tsx`
loads caregivers via:
```ts
supabase.from("caregivers").select("id, first_name, last_name, city, state, hourly_rate")
  .eq("agency_id", profile?.agency_id ?? "").eq("is_active", true).order("first_name")
```
No skill/cert/availability/time-off/office filtering at all. The only signal shown is
a lightweight, **advisory-only** `checkAssignmentConflicts()` call (same-day overlap
+ approved time-off, nothing else) that renders as a non-blocking "Scheduling
warnings" banner — the dropdown itself is never narrowed. This directly contradicts
the Plan's explicit requirement ("MUST show only eligible caregivers... never the
full roster"). The hard gate only exists at the server-side RPC, reached only after
the manager has already picked someone and clicked Confirm.

**Fix, not rebuild:** the dialog already has everything it needs to call
`evaluateEligibility()` per caregiver (or a new bulk RPC) and either filter the
`<Select>` list to eligible candidates or badge each option — the `ShiftTrades.tsx` +
`EligibilityReport.tsx` pair is a ready-made, already-correct model for exactly this.

---

## 4. Caregiver → Shift direction

Two genuinely different flows exist under this heading, confirmed distinct:

- **`AvailableShifts.tsx`** (caregiver's own self-service "pick up a shift" page):
  fully built, correctly calls `pickUpShift()` → `caregiver_pick_up_shift()` (which
  enforces the full engine, no overrides). **Broken by an unrelated, already-known
  RLS gap**, confirmed still present: `shifts`' only non-staff `SELECT` policies are
  "own assigned shift" and "own client's shift" — there is no policy granting a
  caregiver visibility into an `open`, unassigned shift. The query
  (`.eq("status", "open")`, no other client-side filtering) is otherwise correct and
  reasonable; RLS silently returns zero rows for every caregiver, matching
  `known-issues.md`'s existing entry exactly, unaffected by M1/M-Office/Phase 0.
  **This is an RLS fix, not an eligibility-engine fix** — a straightforward additive
  `SELECT` policy (`status IN ('open','unassigned') AND agency_id = current_agency_id()`,
  narrowed further by office once Rule B lands), pending the product decision
  `known-issues.md` already flags (all open shifts vs. only-eligible-ones).
- **`PickShiftDialog.tsx`** (staff-facing, from `CaregiverGridView.tsx`: pick a
  *shift* for a given *caregiver*, the reverse of Manual Assign): takes a `shifts`
  array as a prop and only searches/sorts it — it does **not** itself call the
  eligibility engine. Whatever pre-filtering (or lack of it) happens is entirely
  determined by what `CaregiverGridView.tsx` passes in; if that's simply "all
  unassigned shifts" (consistent with the same full-roster pattern seen in Manual
  Assign), this has the identical gap as §3, just mirrored. Confirmed both dialogs
  route their actual confirm action through `assignShift()`, so the server-side gate
  is intact either way — the gap here, as in §3, is UI-level pre-filtering, not
  write-path safety.

---

## 5. Time-off + shift-trade integration

**Rule H (approved time-off) is respected, but as a soft/overridable rule, not
hard** — see §1's table. `TimeOffDecisionDialog.tsx` handles the *approval* side
well: on approving a request, it finds conflicting already-scheduled shifts and lets
the manager choose to release them (via the trigger-protected
`release_shift_assignments()` RPC — confirmed correctly agency-scoped, though not yet
office-scoped, same Rule-B gap as everywhere else) or post them to the trade board.

**Shift trades ARE validated against eligibility — confirmed, and this is a positive
finding, not a gap.** No dedicated trade RPC exists (`pg_proc` search for `%trade%`
returned zero results), but `ShiftTrades.tsx`'s `completeTrade()` correctly:
1. Calls `evaluateEligibility()` (the shared engine, via RPC) to preview and block
   the UI action if `!result.eligible`.
2. Routes non-staff acceptance of a soft-blocked trade to manager approval instead of
   auto-completing.
3. **Commits the actual reassignment via `assignShift()` → `assign_caregiver_to_shift()`**
   — the same authoritative, server-enforced path everything else should use.

This is the one component that already matches the Plan's "one shared engine, used
everywhere" ideal. It should be the reference implementation Phase 1B points Manual
Assign and Smart Assign toward, not something needing its own fix.

---

## 6. Scheduling row creation — every write path (the §7.3 NULL-office finding)

Confirmed by direct code search (frontend + Edge Functions), not assumed:

| Table | Write path(s) | `virtual_office_id` set today? | Fix shape |
|---|---|---|---|
| `shifts` | **`OrderWizardDialog.tsx`** only (bulk-inserted as a byproduct of building/editing a client order's schedule — no standalone "create shift" page exists) | **No** — confirmed via direct grep; the insert sets `agency_id: agencyId` explicitly (line ~219) but never `virtual_office_id` | Small, precise: add `virtual_office_id: <client's own office>` alongside the existing `agency_id: agencyId` in the same row-building code — the client's office is already resolvable the same way `agencyId` already is. |
| `client_orders` | **`OrderWizardDialog.tsx`** only (same component, the order-create branch) | **No** — same pattern, `agency_id: agencyId` set explicitly (line ~182), `virtual_office_id` never set | Same shape as `shifts` — one component, two insert sites, same missing field. |
| `time_off_requests` | **`CaregiverTimeOff.tsx`** (`handleSubmitRequest`) — the only write path | **No, but a precedented fix exists already in the schema.** A `BEFORE INSERT` trigger, `trg_time_off_agency_id` → `set_time_off_agency_id()`, already derives `agency_id` from `caregiver_id` when NULL (confirmed by reading the trigger function body: `SELECT agency_id INTO NEW.agency_id FROM caregivers WHERE id = NEW.caregiver_id`) — this is *why* the frontend comment says "agency_id is derived server-side" despite being a direct client insert with no `agency_id` in the payload. | **Extend this exact, already-proven trigger** to also set `NEW.virtual_office_id` from `caregivers.virtual_office_id` when NULL. Lowest-risk fix of the three — no application code change needed at all, just widening one existing trigger function by one field, following its own established pattern. |
| `time_entries` | **No write path exists in the app today** — confirmed by code search; the only rows in the table were seed-migration-inserted (`20260909033000_seed_time_entries_for_completed_shifts.sql`). Read-only usage exists (`HoursDeliveredTab.tsx`/`hoursDelivered.ts` for reporting). | N/A — nothing creates rows yet | No fix needed *yet*. Flag for whenever a clock-in/clock-out feature is actually built — design it with `virtual_office_id` (derived from `shift_id → shifts.virtual_office_id`, per the Phase 0 plan's own reasoning) from day one rather than retrofitting. |
| `shift_trades` | `ShiftTrades.tsx` (offer/accept/cancel) and `TimeOffDecisionDialog.tsx` (auto-created on time-off approval with conflicts) | N/A — `shift_trades` has no `virtual_office_id` column at all; it wasn't in Phase 0's five-table scope and isn't part of this finding | Out of scope for this fix — `shift_trades`' own office-scoping (if ever needed) is a separate, future decision, not part of closing the Phase 0 §7.3 gap. |

**Net picture:** exactly **one component** (`OrderWizardDialog.tsx`) accounts for both
the `shifts` and `client_orders` NULL-office gaps, and **one small, already-precedented
trigger extension** closes the `time_off_requests` gap with no application code
change. `time_entries` has no live write path to fix yet. This is a much smaller,
more contained fix than "audit and fix scheduling row creation" might have implied
going in — three concrete, small changes, not a sprawling one.

---

## 7. Recommended Phase 1B Scope

**Fix, don't rebuild** (the engine works; the gap is who calls it):
1. Add Rule B (virtual-office scope) to `check_assignment_eligibility()` — mirrors
   Rule A exactly (`cg.virtual_office_id IS DISTINCT FROM s.virtual_office_id`), one
   `IF` block.
2. Retrofit `match-caregiver` to call `check_assignment_eligibility()` per candidate
   first and exclude anyone with `hard.length > 0` from the results entirely (not
   just score them down) — the scoring math itself doesn't need to change. Also
   filter the initial caregiver query by `virtual_office_id` once Rule B exists.
3. Retrofit `AssignShiftDialog.tsx`'s caregiver list to filter (or clearly badge)
   ineligible candidates, using `evaluateEligibility()` from the already-correct
   `shiftEligibility.ts` — following `ShiftTrades.tsx`'s proven pattern, not a new
   design.
4. Fix `AutoFillDialog.tsx`'s silent-failure UX — surface *why* each failed proposal
   was rejected (the RPC's error message already contains this), not just a bare
   count.
5. Add the caregiver-open-shifts `SELECT` policy to `shifts` (closing the
   `AvailableShifts.tsx` known-issue) — **pending the product decision already
   flagged in `known-issues.md`** (all open shifts vs. eligibility-pre-filtered) —
   this decision blocks this one item, not the rest of Phase 1B.
6. Close the three write-path NULL-office gaps from §6: `OrderWizardDialog.tsx`'s two
   inserts (small code change) and extending `trg_time_off_agency_id`'s trigger
   function (small SQL change, no app code).

**Design decisions needed before coding** (flagged, not resolved here):
- **Rule D (role compatibility):** no schema concept of "caregiver role vs. shift
  required role" exists today distinct from skills — confirm whether Rule D is
  actually meant to be Rule E (skills) under a different name in the Plan's
  numbering, or a genuinely separate concept that needs new schema.
- **Rule K (scheduling flexibility):** flagged by the Plan itself as needing an
  explicit operational definition before coding — still true, nothing exists yet.
- **Rule H's severity (hard vs. soft):** the Plan's own §6.1 lists approved time-off
  as a hard rule; the live implementation treats it as soft/overridable. Decide
  whether to tighten it to hard (a real behavior change, needs its own regression
  check) or update the Plan's framing to match the deliberately-softer existing
  design.
- **Rule J's severity (advisory vs. soft/hard):** service-area mismatch is currently
  the *weakest* category (advisory only, never blocks or requires override) — decide
  if that's intentional (continuity-of-care flexibility) or should be tightened to at
  least soft.
- **`AvailableShifts.tsx`'s open question**, already tracked in `known-issues.md`:
  all open shifts vs. eligibility-pre-filtered.

**Explicitly not proposed for Phase 1B:** rebuilding `match-caregiver`'s scoring
formula, redesigning `shift_trades` (already correctly wired), or building a
`time_entries` write path speculatively before a clock-in/clock-out feature is
actually scoped.

## What This Audit Deliberately Does Not Do

Change any code, schema, or data. Decide the four flagged design questions in §7 —
surfaced for your review, not resolved. Build the Rule B addition or any of the
retrofits described — that's Phase 1B, pending your review of this report.
