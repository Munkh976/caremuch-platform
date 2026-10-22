# Auto-assign by period and Smart scheduling: investigation and restore plan

Status: **INVESTIGATION + PLAN ONLY** (2026-10-21, read-only: git history, current code, DEV catalog and function list).
No code was changed for it. Waiting for the owner's decision.

Scope note (CLAUDE.md): Smart Scheduling as an *AI / ML agent* is out of scope for this architecture version. Everything
below is the existing deterministic scheduling feature (Phase 1B engine, Smart Assign, Auto-fill), which must be
preserved; any change to it needs the owner's approval and NB1 proof.

## A. Auto-assign by period ("Auto-fill this period")

**It was never removed. It is reachable today:** Schedule → tab **Unassigned** → button **Auto-fill this period**.
- The period is the Schedule page's own **Day / Week / Month** toggle and arrows (`rangeMode`, `rangeLabel` in
  `src/pages/Schedule.tsx`); the button proposes for every unassigned shift in that range.
- The button only appears when the range has at least one unassigned shift
  (`UnassignedShiftsView.tsx`: `onAutoFill && shifts.length > 0`). In the demo office there is exactly 1 unassigned
  visit (next week's Thursday), so in the default week view on the demo day **the button is not shown**; that is the
  likely reason it looked gone. At 390 px the Schedule tab bar is wider than the screen (logged in S10/S14), so the
  Unassigned tab is also easy to miss on a phone.
- **History:**
  - created 2026-07-28 (`99a3110` `AutoFillDialog.tsx` + `SmartAssignSheet.tsx`; `0ef7b3d` the button in
    `UnassignedShiftsView`, `720b56a` wiring in Schedule);
  - same day `9258208` deleted the older standalone pages **AutoSchedule**, **QuickAssign** and **LiveOperations** (and
    their menu entries). AutoSchedule was a client-side "fill open shifts" page that ranked by
    `performance_rating × 0.6 + reliability_score × 0.4`; Auto-fill replaced it;
  - 2025-11-04 `9a5b439` folded the old **UnassignedShifts** page into Schedule's Unassigned tab (that page had an
    `auto_assign` flow too);
  - 2026-09-15 `e8dfa61` (Smart Scheduling Phase 1B): Auto-fill commits through `assign_caregiver_to_shift` (server
    re-checks eligibility) and shows each failure's real reason;
  - 2026-10-06 `938a4d7` (Ripple S10): round 8 tested Auto-fill with the care-plan checks (`autofill-on-1440.png`).
- **How it works now** (`AutoFillDialog.tsx`): opens → calls `match-caregiver` once per unassigned shift, sequentially,
  in the browser → takes the best match not already proposed **on the same date** → table of proposals (caregiver,
  score, warnings, checkbox) → **Assign** commits each through `assignShift()` → `assign_caregiver_to_shift`
  (`method = 'auto_assigned'`), reporting each failure's reason.

## B. Smart scheduling

- **Smart Assign** (per shift): Schedule → Unassigned (and Today) → a shift's **Smart assign** → `SmartAssignSheet.tsx`
  (ranked list with score, key factors, warnings) → Assign. Reachable today.
- **`match-caregiver` Edge Function:** deployed on DEV (version 13, last deployed at Phase 1B, Sept 15). Deterministic
  since `886710f` (Sept 1); before that it asked an LLM (Lovable gateway, 6-factor prompt) and sent client data, which
  is why it was rewritten.
- **The model today is 5 weighted factors, not 20+** (`WEIGHTS` in `match-caregiver/index.ts`, sum 100):

  | Factor | Weight | Input | Neutral when |
  |---|---|---|---|
  | Skill coverage | 40 | caregiver skills vs the shift's care type + the client's declared care needs | — |
  | Service area | 25 | client zip in the caregiver's `service_zipcodes` | caregiver lists no zips |
  | Availability | 15 | declared weekly availability covers the shift's day and times | none declared |
  | Reliability | 10 | `caregivers.reliability_score` / 100 (warning below 70) | — |
  | Performance | 10 | `caregiver_performance` avg rating, completion, on-time | not rated yet |

  Before scoring, everyone `check_assignment_eligibility_bulk` marks **hard-blocked** is removed (Phase 1B).
  "Preferred caregiver" only adds a key-factor line; it doesn't change the score.
- **No 20+ factor model exists in the repository or its history.** What does exist:
  - the old 6-factor LLM prompt (removed Sept 1);
  - the **planned** Phase 2 ranking (`docs/CareMuch_Smart_Scheduling_Consolidated_Plan.md` §7): preferred caregiver,
    continuity, reliability, performance, distance, workload balance, availability fit. **Not built** (Phase 2 never
    started);
  - `virtual_office.smart_match_weights` (JSON, editable on Virtual Offices → Scheduling overrides): **read by nothing**;
    `match-caregiver` uses its hard-coded weights.
  If the "20+ factors" came from a slide or an earlier Lovable prototype, it isn't in this repo.
- **The intermittent HTTP 500** (known-issues, Oct 7): the function catches errors and returns `error.message` only for
  real `Error` objects; a Supabase query error is a plain object, so it surfaces as "Unknown error". Which query fails
  intermittently is not known (the same queries work from Node). Not investigated further (unchanged scheduling).
- **Pages / menus that used to show it:** AutoSchedule, QuickAssign, LiveOperations (deleted July 28, `9258208`); the
  old UnassignedShifts page (folded into Schedule, Nov 2025). Today: Schedule → Unassigned / Today only.

## C. Gaps against today's rules

| Rule | Auto-fill / Smart Assign today | Gap |
|---|---|---|
| **Caller scope (M-Office)** | `match-caregiver` uses the **service role** and **never checks who is calling**: any valid JWT (the anon key is one) with a shift id gets the office's caregivers incl. **e-mail and phone**. The candidate pool is scoped to the shift's office, not to the caller. | **Security gap (new finding), confirmed on DEV Oct 21:** a call with only the public anon key (no login) and a demo-office shift id returned HTTP 200 with 4 caregivers incl. e-mail, phone and hourly rate (counts printed, no values). A shift id is a UUID, so it must be known first, but it is still an unauthenticated read of staff contact data. Missed by the October batch (M-SEC-2b covered other functions). Needs a caller check (staff + `cp_staff_in_scope` of the shift's office) before any restore. `check_assignment_eligibility(_bulk)` also has no caller check (it returns eligibility details, incl. credential names, for any shift id). |
| Credentials | hard rules (expired / unverified) exclude; the Ripple "required credential missing" rule is hard only with enforcement on | advisory issues aren't shown as such in the proposals |
| Training on the **current** IPOS version | via `cp_eligibility_core`: hard with enforcement on, **advisory (and still proposed) with it off** | Auto-fill can propose an untrained caregiver when enforcement is off; the advisory line isn't in its table |
| Authorization units and **period caps** | projection (`cp_projected_units`) per shift; hard/advisory by the switch | each proposal is checked **alone**: ten proposals in one week can together exceed a weekly cap or the remaining units (no running total across the proposal set) |
| Group ratio | advisory in the Assign dialog UI only | not considered |
| Overlaps between proposals | dedup is **per date**, not per time window | blocks valid back-to-back shifts; a split shift is never proposed twice to one caregiver |
| Enforcement switch | respected by the server at commit | proposals don't say "advisory" |
| New S17 rules 1a / 1d | apply when a shift is **created or moved** | shifts that already exist after the IPOS / authorization end date can still be proposed (eligibility shows "no active plan" / "no authorization on this date", advisory with enforcement off) |
| Continuity | not scored (preferred caregiver = label only) | owner wants continuity first |
| Audit | each commit audits `shift_assigned` through the assign RPC | the proposal run itself (who ran it, what was proposed / skipped and why) isn't recorded |
| Performance | one Edge Function call per shift from the browser | a month can be hundreds of sequential calls |

## D. Restore plan (for decision)

Goal: Schedule → Unassigned → **Auto-assign** with a **Day / Week / Month** picker → **preview** (proposed assignments
with reasons; blocked shifts with reasons) → manager confirms (all or some) → audited. **Continuity first.**

1. **Server-side proposal RPC** `propose_auto_assignments(_office_id, _from, _to)` (new, SECURITY DEFINER,
   `cp_require_scope` manager / agency_admin / scheduler of the office; REVOKE / GRANT + aclexplode). Read-only (writes
   nothing); returns for every unassigned shift either a proposal or the reasons it can't be filled.
   - Candidates: active caregivers of the shift's office with the care type skill.
   - Gate: **`cp_eligibility_core`** (unchanged) per candidate; with enforcement **off**, care-plan advisory issues
     still **exclude** a candidate from the proposal (owner to confirm: "propose only what would pass with enforcement
     on"), but the manager can still assign them by hand.
   - Running totals across the proposal set: caregiver time windows (no overlaps), authorization units and per-period
     caps (`cp_projected_units` + already-proposed units), group sessions' ratio.
   - Order: hardest shifts first (fewest eligible candidates), then date.
   - Score (explainable, deterministic): **continuity** (served this client in the last 60 days; preferred caregiver)
     first, then skills / availability / service area / reliability / performance (today's weights), workload balance
     as the tie-breaker. Each proposal carries its reasons ("served Zoe 6× in 60 days · trained v2 · 3 of 16 weekly
     units left").
2. **Commit** `commit_auto_assignments(_run_id, _shift_ids)` (new): re-runs eligibility per shift and calls the same
   assignment path as `assign_caregiver_to_shift` (`method = 'auto_assigned'`); skips any shift that changed since the
   preview, with the reason. One audit event for the run (`auto_assign_run`: ids, counts, period; events CHECK change
   needs approval) plus the existing `shift_assigned` per assignment.
3. **UI:** Unassigned tab → **Auto-assign…** dialog with its own Day / Week / Month picker (defaults to the page range),
   always visible (disabled with "no unassigned shifts in this period" instead of hidden); preview table (proposed /
   blocked with reasons, checkboxes); confirm. Smart Assign (per shift) uses the same scoring through a single-shift
   variant of the RPC.
4. **`match-caregiver`:** fix the caller check first (or retire it in favour of the RPC once the UI moved); fix the
   "Unknown error" by returning the database message. Both are changes to an existing Edge Function: approval.
5. **Tests:** PGlite (proposal rules: overlaps, caps across the set, enforcement on / off, continuity order, office
   scope, refusals), DEV before / after with **NB1** (assign paths unchanged), browser round with Day / Week / Month,
   390.

**What reuses existing functions unchanged:** `cp_eligibility_core`, `cp_projected_units`, `cp_period_left`,
`assign_caregiver_to_shift` (called, not modified), `cp_require_scope`. **Needs approval:** the two new RPCs, the
events CHECK value, the `match-caregiver` caller check / error fix, removing or rewiring `AutoFillDialog` /
`SmartAssignSheet`, and whether advisory care-plan issues exclude candidates when enforcement is off.

**Open questions for the owner:**
1. With enforcement off, should Auto-assign propose caregivers who have advisory care-plan issues (untrained on the
   current IPOS, credential missing)? Recommended: no.
2. Continuity window: served this client in the last 60 days? Any minimum number of visits?
3. Should the scheduler role run it, or managers / agency admins only?
4. Fix the `match-caregiver` caller check now, as a security fix, independent of the restore? Recommended: yes.

## E. Assign entry points (owner item 4g, report before changing)

| Entry point | Opens | Caregiver list / proposal from | Write |
|---|---|---|---|
| Schedule → **Shifts** list → Quick assign | `AssignShiftDialog` | `check_assignment_eligibility_bulk` (as the user) | `assign_caregiver_to_shift` |
| Schedule → **Unassigned** → Assign | `AssignShiftDialog` | same | same |
| Schedule → Unassigned → **Smart assign** | `SmartAssignSheet` → (Assign) `AssignShiftDialog` prefilled | `match-caregiver` (hard-blocked removed by the same bulk check, run as the user since the hotfix) | same |
| Schedule → Unassigned → **Auto-fill this period** | `AutoFillDialog` | `match-caregiver` per shift | same (`method = auto_assigned`) |
| Schedule → **Today** (live ops) → assign | `SmartAssignSheet` | `match-caregiver` | same |
| Schedule → **By Caregiver** → Assign shift | `PickShiftDialog` (unassigned shifts, no eligibility shown) → `AssignShiftDialog` prefilled caregiver | bulk check | same |
| Schedule → **By Client** → a shift → shift details → Assign | `ShiftDetailsDialog` → `AssignShiftDialog` | bulk check | same (`ClientGridView` gets an `onAssign` prop it never uses) |
| **Shift Trades** → approve coverage | inline | `check_assignment_eligibility` (single); on a server error it falls back to the old client-side rules (`evaluateEligibilityLocal`, display only) | same |
| **Client Scheduling tab** | read-only (no assign); "Open full Schedule →" | bulk check for the next unassigned shift | — |
| Caregiver Available Shifts / Trade Board | pickup | `check_caregiver_shifts_eligibility` → the same engine | `caregiver_pick_up_shift` / `caregiver_pickup_trade_shift` |

**One engine:** every list and every write uses `cp_eligibility_core` (through `check_assignment_eligibility(_bulk)`), and
every staff write goes through `assign_caregiver_to_shift`, which re-checks; nothing assigns by a direct table write.
`AssignShiftDialog` already lists **hard-eligible** caregivers by default (typing a name shows everyone); advisory
care-plan lines (enforcement off) are shown but don't hide anyone.

**Proposed change (waiting for the owner's OK):** in `AssignShiftDialog` the default list becomes the 4a gate (eligible
with enforcement ON: no hard issue, no soft issue, no care-plan advisory issue, client onboarded) with a toggle
**"Show all (N not eligible)"** that shows the rest with today's advisory / blocked lines (manual assignment stays possible).
The other entry points reach that same dialog, so one change covers them; Shift Trades' local fallback would be removed
(server only). Smart Assign and Auto-assign use the same gate.
