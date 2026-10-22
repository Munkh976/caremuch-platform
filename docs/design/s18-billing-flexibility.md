# S18 — Billing flexibility: design note

Status: **BUILT** (Oct 22, owner-approved with smallint units_adjusted and the rule stored per note). Migration 20261031140000. Open: unit length other than 15 minutes; the caregiver preview under a non-default rule (see known-issues).

## 1. Today

- **`cp_derive_progress_note_units`** (S12; trigger on `progress_notes`) bills the shift's scheduled **15-minute**
  blocks that lie completely inside [arrival, end], at minute precision. The rule is hardcoded.
  - It recalculates only on insert and while the note is draft or returned (no backfill).
  - Submitted, reviewed and billed notes keep their stored `units_used`.
- **Units are charged at review:** `review_progress_note` picks the authorization FIFO and applies the weekly cap.
  `units_available` is derived by trigger.
- **`get_billing_week` / `get_billing_batch`:** one line per client × authorization, with the notes listed inside the
  line.
- **Arrival and end** are edited by the caregiver in `save_progress_note_draft` while the note is draft or returned.
  Nothing feeds them from clock-in or clock-out yet.

## 2. Proposal

### 2a. Office units rule (no hardcoded rule)
- New office columns (additive):
  - `units_minutes smallint NOT NULL DEFAULT 15` (1..60);
  - `units_rule text NOT NULL DEFAULT 'full_blocks'`, CHECK `full_blocks | nearest | grace`;
  - `units_grace_minutes smallint NOT NULL DEFAULT 0` (0..14).
- A new pure function `cp_units_for(scheduled_start, scheduled_end, arrived, ended, minutes, rule, grace)`
  (IMMUTABLE). The trigger calls it with the office settings instead of its inline arithmetic. That changes an
  existing trigger function: approval.
- **Rules:**
  - `full_blocks`: today's S12 rule exactly.
  - `nearest`: (served minutes ÷ unit) rounded half-up, capped at the scheduled units.
  - `grace`: the arrival counts as on time up to N minutes late (and the end up to N minutes early), then full blocks.
- **Identical results guaranteed:**
  - PGlite runs every S12 case (09:00–10:00 matrix, respite, group, no schedule, returned) through the old and the
    new trigger and compares them: identical with the defaults.
  - DEV `before` runs a read-only comparison over every note: 0 notes would differ.
  - No backfill: settings apply from the next draft save on.
- **Settings UI:** a "Billing units" card on the office Compliance tab (agency_admin, audited
  `office_units_rule_changed`; events CHECK: approval). It shows an example table (on time, 9:07, left at 9:52).

### 2b. Reviewer adjusts "units to bill" before review
- New note columns (additive): `units_adjusted numeric NULL`, `units_adjust_reason text`, `units_adjusted_by uuid`,
  `units_adjusted_at timestamptz`.
- The trigger uses `COALESCE(units_adjusted, calculated)` (same trigger change as 2a).
- **A new `adjust_note_units(_note_id, _units, _reason)`** (SECURITY DEFINER, manager / agency_admin in scope;
  REVOKE / GRANT, checked with aclexplode):
  - Submitted notes only.
  - 0 ≤ units ≤ `units_scheduled`.
  - A reason of at least 10 characters.
  - `_units = NULL` clears the adjustment.
  - Audit `progress_note_units_adjusted` with the old and new units and ids (no reason text in the event).
- **Effect:**
  - FIFO, the weekly cap and `units_available` are recomputed at review exactly as today, because review reads
    `units_used`.
  - Undoing a review keeps the adjustment.
  - Billed notes stay locked.
- **UI:** the Review panel shows "Calculated 3 · Adjusted 4 (reason …)" with **Adjust units**. The weekly bill and
  the CSV show the billed (adjusted) units, plus a marker.

### 2c. Weekly bill: one line per day of service
- A new read `get_billing_week_days(_office_id, _week_start)`. Additive, so `get_billing_week` stays unchanged.
- It returns lines keyed by client × authorization × service date: units scheduled, units billed, notes, a late /
  early marker and an adjusted marker.
- Weekly Billing gets a toggle **By authorization / By day**, and the CSV export follows the selected view.
- Totals are proven equal between the two views (test).

### 2d. Arrival / end
- Unchanged: editable by the caregiver while draft or returned.
- **Later (separate slice):** prefill from clock-in / clock-out (`time_entries`) when present, still editable.
  Recorded here only; no change in S18.

## 3. Data model summary (all additive)

| Change | Kind |
|---|---|
| `virtual_office.units_minutes`, `units_rule`, `units_grace_minutes` | columns |
| `progress_notes.units_adjusted`, `units_adjust_reason`, `units_adjusted_by`, `units_adjusted_at` | columns |
| events CHECK + `office_units_rule_changed`, `progress_note_units_adjusted` | constraint (approval) |

## 4. Functions affected

| Function | Change | Approval |
|---|---|---|
| `cp_units_for` | new (internal, pure) | — |
| `adjust_note_units` | new | — |
| `set_office_units_rule` | new | — |
| `get_billing_week_days` | new | — |
| `cp_derive_progress_note_units` | reads office settings + adjustment | yes |
| `get_progress_note_for_staff` | exposes calculated vs adjusted | yes |
| `list_notes_for_review`, CSV builder (UI) | adjusted marker | reader change: yes |

**Unchanged:** `review_progress_note`, the batch functions, eligibility and projection (they read `units_used`).

## 5. Tests

- **PGlite:**
  - old vs new trigger equivalence on the full S12 matrix with the defaults;
  - each rule (nearest, grace N) at its boundaries;
  - adjust: refused unless submitted, bounds, reason, billed lock, roles / offices;
  - review after an adjustment charges the adjusted units (FIFO and the weekly cap);
  - undo keeps the adjustment;
  - per-day read totals equal the per-authorization totals;
  - audit; ACLs; rollback proof (trigger md5 equals DEV).
- **DEV before / after:** NB1, a count of notes whose units would change with the defaults (must be 0), real-login
  adjust → review → bill.
- **Browser:** settings card, Review panel adjust, the By-day bill and CSV, 1440 / 390. Rehearse step for the
  adjusted note (optional).

## 6. Risks

- **Rule changes mid-week** give drafts different rules. The settings card says "applies to notes saved from now on".
  Billed notes are never touched.
- **Adjustments hide caregiver data issues.** The reason is required, it's audited, and the original calculation
  stays visible.
- **Rounding up beyond the authorization:** caps stay enforced at review. A refused review keeps the note submitted
  with the server reason (as today).
- **Medicaid unit rules differ by payer:** the setting is per office, not per payer. A per-authorization override
  could come later if Ripple needs it.
