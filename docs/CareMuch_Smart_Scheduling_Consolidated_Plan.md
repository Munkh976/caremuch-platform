# CareMuch Smart Scheduling — Consolidated Development Plan

**Status:** Planning document. Consolidates the "reviewed" and "revised" plans, grounded
in the current codebase reality (post M1 + M-Office). Fix-and-complete effort, not
greenfield. Deterministic first; ML deferred.

**Implementation strategy:** Phase 0 → Phase 1A (audit) → Phase 1B (eligibility) →
Phase 2 (ranking) → Phase 3 (auto-fill) → Phase 4 (ML, deferred)

---

## 1. Executive Summary

Smart Scheduling is built as **four separated layers**, never one monolithic "matching
algorithm":

1. **Eligibility Engine** — *Is this assignment allowed?* (hard rules, binary, deterministic)
2. **Smart Assign Ranking** — *Among eligible candidates, who is best?* (soft weighted score, explainable)
3. **Auto-fill This Period** — *Fill many shifts well as a set?* (deterministic optimization)
4. **ML-assisted Optimization** — *Learn from outcomes?* (deferred until real data exists)

> **Core rule: Hard eligibility is a FILTER. Ranking is a separate SCORING layer.
> Auto-fill is a multi-shift OPTIMIZATION layer. ML is a future enhancement. Never
> collapse these into each other.**

**This is a fix-and-complete effort.** CareMuch already has substantial scheduling
infrastructure (`shifts`, `shift_assignments`, `check_assignment_eligibility`, Smart
Assign UI/logic, `caregiver_skills`/`_certifications`/`_availability`, time-off, shift
trades). The stated problem is "the design exists but doesn't work." Therefore the
FIRST real work is auditing what exists and why it fails — not rebuilding blindly.

**One shared eligibility engine, used everywhere and in both directions:**
- Shift → Caregivers (show only eligible caregivers for a shift)
- Caregiver → Shifts (show only shifts a caregiver is eligible for)
- Manual Assign, Smart Assign, Auto-fill, and (later) shift-trade validation all call
  the SAME engine. No duplicate eligibility logic anywhere.

---

## 2. Codebase Reality This Plan Is Grounded In

These are known facts about the current system (from prior work), not assumptions:

- **M1 (agency isolation)** and **M-Office (virtual-office scoping)** are DONE and proven.
  RLS enforces `agency_id` everywhere and `virtual_office_id` on the operational core that
  has the column.
- **CRITICAL DEPENDENCY (M-Office §8.4):** `shifts`, `shift_assignments`, `client_orders`,
  `time_entries` do **NOT** have `virtual_office_id` yet. Scheduling's first eligibility
  rule (agency + office scope) therefore CANNOT be office-aware until Phase 0 adds these
  columns. **Phase 0 is a hard prerequisite.**
- **`shifts.caregiver_id` is a DERIVED column** — a trigger (`trg_enforce_derived_shift_caregiver`)
  forces it from `shift_assignments`. You cannot assign by writing `caregiver_id`; you
  create a `shift_assignments` row via the sanctioned path (`assign_caregiver_to_shift()`
  RPC), which the eligibility engine must gate. Any assignment code MUST go through
  assignments, never the derived column.
- **`assign_caregiver_to_shift()` RPC exists** and refuses shifts already 'completed'/
  'cancelled' — it's for live assignment, not historical backfill.
- **`check_assignment_eligibility` exists** (referenced in CLAUDE.md) — status unknown;
  Phase 1A audits it.
- **Time-off and shift-trade systems exist** — the eligibility engine must respect
  approved time-off (a hard rule) and reuse the engine for future trade validation.
- **Three-tier roles exist** (M-Office): system_admin, agency_admin, virtual_office
  manager. A virtual-office manager schedules ONLY their office; the engine's candidate
  pool must respect `current_virtual_office_id()`.

---

## 3. Scheduling Data Classification (SAFETY — read before any rule)

### 3.1 Approved structured scheduling inputs

**Shift/client side:** required role, required skills, required certifications, shift
time window, client location (zip/coordinates), client `scheduling_flexibility`,
client's virtual office + agency, care service type/codes.

**Caregiver side:** agency + virtual office, active/employment status, role, skills,
certifications (and validity dates), availability windows, existing assignments,
location/service area, reliability metric, performance metric, prior assignment history
with this client (continuity).

### 3.2 Fields EXCLUDED from automated matching (hard exclusion — safety/ethics/legal)

The following **must NEVER be used** as matching or ranking inputs:
- **Client medical conditions / diagnoses** — matching caregivers to clients by medical
  condition risks discriminatory, unsafe, and unlawful automated decisions. Medical info
  informs CARE, not staffing eligibility.
- **Client free-text notes** — unstructured, unvalidated, may contain protected or biasing
  information. Not a matching signal.
- **Free-text scheduling notes** — same reasoning.

### 3.3 Why this matters

Automated staffing decisions based on medical conditions or free-text could produce
discriminatory outcomes, expose PHI in a matching context, and be legally hazardous.
Eligibility and ranking use ONLY structured, defensible, auditable fields. This exclusion
is a hard acceptance criterion, tested explicitly.

---

## 4. Phase 0 — Office-Scope the Operational Tables + Existing-Code Audit Prep

**Phase 0 is a prerequisite. Do not make scheduling office-aware on tables that lack the
office column.** This is the M-Office §8.4 increment.

### 4.1 Add `virtual_office_id` to the operational scheduling tables

- Add `virtual_office_id` (nullable, FK to `virtual_office`, ON DELETE SET NULL) to:
  `shifts`, `shift_assignments` (or derive via `shift_id` helper, matching its existing
  `agency_id`-via-shift pattern), `client_orders`, `time_entries`, `time_off_requests`.
- **Backfill** from the natural join: a shift's office = its client's office
  (`client_id → clients.virtual_office_id`); a time_entry's office via its caregiver/shift.
  (Confirmed product decision from M-Office §6: shift office is CLIENT-side.)
- Add the office-composition RLS clause (the M-Office pattern:
  `NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()`)
  to each table's policies. Fail-CLOSED (reuse the `office_restricted` marker + constraint).

### 4.2 Two-office isolation test for the scheduling tables

Mirror M-Office's test: a Tier-3 manager of Office A cannot see/assign Office B's shifts;
Tier-2 sees both; system_admin sees all; the live demo is unaffected. **Do not proceed to
Phase 1 until this passes** — same done-definition discipline as M1/M-Office.

### 4.3 Phase 0 deliverables

- Migration(s) adding + backfilling `virtual_office_id` on the scheduling tables.
- Office-scoped RLS on those tables, fail-closed, tested.
- The two-office scheduling isolation test, passing.
- Confirmation the derived-caregiver trigger and `assign_caregiver_to_shift()` still work
  post-change (regression).

---

## 5. Phase 1A — Audit Existing Scheduling (inspect before building)

**"The design exists but doesn't work" means there is code to understand first.** Audit,
produce a gap report, decide fix-vs-rebuild per component. No new logic yet.

### 5.1 Audit `check_assignment_eligibility`
- What is it — RPC, function, client code? What rules does it actually check today?
- Map its checks against the Phase 1B rule set (A–J below): which rules exist, which are
  missing, which are broken/incorrect?
- Does it return a structured explainable result, or just a boolean?
- Is it called by the current Manual/Smart Assign UI, or orphaned?

### 5.2 Audit Smart Assign (the "doesn't work" part)
- What does the current Smart Assign do — does it call eligibility, does it rank, how?
- WHY does it not work? (No eligibility filter? Broken ranking? Missing data? Calls the
  derived `caregiver_id` instead of the assignment RPC? Not office/agency scoped?)
- Is the UI wired to a function that errors, returns nothing, or returns wrong candidates?

### 5.3 Audit Manual Assign
- Does the manual caregiver picker filter by eligibility, or show ALL caregivers?
- (Plan requirement: manual assign MUST filter by the same hard eligibility rules.)

### 5.4 Audit Caregiver → Shift direction
- Does assigning-from-a-caregiver exist? Does it reuse eligibility (reversed)?

### 5.5 Audit Time-Off + Shift Trades integration
- Does eligibility currently respect approved time-off? (It must — Rule H.)
- Are trades validated against eligibility? (Future reuse target.)

### 5.6 Phase 1A deliverable
A gap report: for each component — exists? works? which rules present/missing/broken?
fix or rebuild? — that drives Phase 1B's scope. **Reviewed before building.**

---

## 6. Phase 1B — The Eligibility Engine (the foundation)

Build/fix ONE deterministic engine answering *"Is caregiver C eligible for shift S?"*
No ML, no LLM, no prediction — explicit business rules only.

### 6.1 Hard eligibility rules

- **Rule A — Agency scope:** `caregiver.agency_id == shift.agency_id`.
- **Rule B — Virtual-office scope:** `caregiver.virtual_office_id == shift.virtual_office_id`
  (enabled by Phase 0; enforced for office-scoped managers).
- **Rule C — Active status:** caregiver is active/available per employment status rules.
- **Rule D — Role compatibility:** caregiver role satisfies the shift's required role.
- **Rule E — Required skills:** every required shift skill is in the caregiver's skills.
- **Rule F — Required certifications:** every required cert is held AND currently valid
  (not expired at shift date).
- **Rule G — Availability:** caregiver is available for the ENTIRE shift window.
- **Rule H — Approved time-off:** caregiver has NO approved time-off overlapping the shift.
- **Rule I — No overlapping assignment:** caregiver has no existing assignment that
  overlaps the shift time (respecting the derived-assignment model).
- **Rule J — Service area:** caregiver can serve the client's location (zip/zip-list/
  radius/distance per agency service-area rules).
- **Rule K — Scheduling flexibility:** apply client `scheduling_flexibility` (strict/
  moderate/flexible) as a STRUCTURED constraint on time-window matching. Define the exact
  operational meaning (e.g. strict = exact window; moderate = ±N min; flexible = wider
  window) as an explicit rule before coding.

### 6.2 Eligibility result contract (structured, explainable — not just a boolean)

```json
{
  "caregiver_id": "...",
  "shift_id": "...",
  "eligible": true,
  "passed_rules": ["agency_scope", "office_scope", "active", "role", "skills", "certs",
                   "availability", "time_off", "no_overlap", "service_area", "flexibility"],
  "failed_rules": [],
  "details": { "missing_skills": [], "expired_certs": [], "overlap_shift_id": null }
}
```
Every failure is explainable ("not eligible: missing skill transfer_assistance; CPR
expired 2026-01-01"). This drives both the UI ("why isn't X shown?") and auditability.

### 6.3 Implementation location
Prefer a single DB-side function/RPC (so all callers — Manual, Smart, Auto-fill, trades —
share ONE source of truth and it's enforced server-side, consistent with the M1/M-Office
"security in the database" discipline). If salvageable, fix/extend
`check_assignment_eligibility` rather than replacing it. The engine must go THROUGH the
assignment model (never write the derived `caregiver_id`).

### 6.4 Both directions, one engine
- **Shift → Caregivers:** run the engine for the shift against the office's caregiver pool;
  return only `eligible: true`.
- **Caregiver → Shifts:** run the engine for the caregiver against the office's unassigned
  shifts; return only those where eligible.
- Same rules, same code, reversed iteration. **No second eligibility implementation.**

### 6.5 Manual Assign requirement
The manual caregiver picker MUST show only eligible caregivers (the engine's output),
never the full roster. "Manual" means the manager chooses among the *eligible*, not that
eligibility is bypassed.

### 6.6 Phase 1 acceptance criteria
- [ ] Agency + virtual-office scope enforced (Rules A/B).
- [ ] Active status, role, skills, certifications (with validity) checked.
- [ ] Availability, approved time-off, and overlapping-assignment conflicts checked.
- [ ] Service area + scheduling flexibility handled as structured rules.
- [ ] Medical conditions / client notes / free-text NEVER used (tested).
- [ ] Failed reasons are explainable.
- [ ] Both directions use the SAME engine.
- [ ] Manual Assign filters by eligibility.
- [ ] Assignment goes through the assignment model, not the derived caregiver_id.

---

## 7. Phase 2 — Smart Assign Ranking (soft scoring, still no ML)

Among ELIGIBLE candidates (Phase 1B output), rank best-to-worst with a deterministic,
explainable weighted score.

### 7.1 Ranking signals (all structured, tunable weights)
- **Preferred caregiver** — client's preferred caregiver ranks higher.
- **Continuity** — caregiver has served this client before.
- **Reliability** — caregiver reliability metric.
- **Performance** — caregiver performance/quality metric.
- **Distance** — closer caregiver ranks higher.
- **Workload balance** — under-utilized caregivers ranked up (avoid overloading).
- **Availability fit** — how cleanly the shift fits their availability.

### 7.2 Design rules
- Ranking operates ONLY on eligible candidates — never resurrects an ineligible one.
- Weights are explicit config, not hardcoded magic — tunable, auditable.
- The score is EXPLAINABLE: the UI shows why ("✓ all skills · 4.2 mi · served before ·
  reliability 96 · light week") — a manager can see the reasoning.
- Deterministic: same inputs → same ranking. No randomness, no ML.

### 7.3 Phase 2 acceptance criteria
- [ ] Ranks only eligible caregivers.
- [ ] Deterministic + explainable.
- [ ] Preferred / continuity / reliability / performance / distance / workload /
      availability-fit each influence ranking.
- [ ] Manager sees why a caregiver was recommended.
- [ ] Works in the caregiver→shift direction too.
- [ ] No ML.

---

## 8. Phase 3 — Auto-fill This Period (deterministic optimization)

Fill ALL unassigned shifts in a chosen period (day/week/month) as a coordinated set.

### 8.1 Behavior
- Manager selects a period + scope (their office).
- System finds all unassigned shifts in scope.
- For each, generates eligible candidates (Phase 1B) + Smart Assign scores (Phase 2).
- Considers INTERACTIONS between assignments (assigning caregiver X to shift 1 affects
  their availability/workload for shift 2) — this is the multi-shift optimization beyond
  per-shift ranking.
- Prioritizes DIFFICULT-TO-FILL shifts first (few eligible candidates) so they don't get
  starved by greedy easy assignments.
- Produces a PROPOSAL (not auto-committed) the manager reviews.
- Manager approves (all/some); unresolved shifts stay visible.
- Records auto-fill decisions/events for auditability + future ML training data.

### 8.2 Approach
- Start deterministic: heuristic/greedy-with-priority (difficult-first), or a bounded
  optimization (e.g. assignment problem with constraints) — NOT ML.
- Never assigns an ineligible caregiver (Phase 1B is the hard gate throughout).
- Assignment application goes through `assign_caregiver_to_shift()` / the assignment model.

### 8.3 Phase 3 acceptance criteria
- [ ] Period selection (day/week/month), office-scoped.
- [ ] Finds unassigned shifts; generates eligible candidates; uses Smart Assign scores.
- [ ] Considers inter-assignment interactions; difficult-to-fill prioritized.
- [ ] Proposal is reviewable; manager approves; unresolved shifts remain visible.
- [ ] Never assigns ineligible caregivers.
- [ ] Records auto-fill events (also seeds Phase 4 data).

---

## 9. Phase 4 — ML-Assisted Optimization (DEFERRED)

Do NOT start ML just because the architecture is ready. Begin only after CareMuch has:
sufficient historical assignments, acceptance/rejection history, attendance + completion
outcomes, manager override data, consistent structured skill/cert data, reliable
availability history, and enough variation to avoid overfitting. Minimum sample size is
decided by examining real collected data, not chosen arbitrarily now.

Phases 1–3 are designed to GENERATE this data (structured eligibility results, ranking
signals, auto-fill decision events, override records) so Phase 4 has a clean training
substrate when the time comes.

---

## 10. Recommended Build Sequence + Discipline

1. **Phase 0** — office-scope scheduling tables + two-office test (prerequisite; M-Office rigor).
2. **Phase 1A** — audit existing scheduling; gap report; review before building.
3. **Phase 1B** — the eligibility engine (fix/extend/rebuild per the audit); tested against
   all rules + the exclusion tests; both directions; manual-assign filtering.
4. **Phase 2** — Smart Assign ranking on eligible candidates; explainable.
5. **Phase 3** — Auto-fill (deterministic); reviewable proposals; event logging.
6. **Phase 4** — ML, only when the data justifies it.

**Discipline (proven this project):** plan → review → implement one phase → test as the
done-definition → review before next. Office/agency scoping enforced server-side. The
eligibility engine is ONE source of truth, DB-side, called everywhere. Assignments go
through the assignment model (never the derived caregiver_id). Frozen-demo discipline:
the live Ripple demo and existing scheduling keep working through each phase.

## 11. Key Risks / Watch-items
- The **derived-caregiver trigger**: any assignment code that writes `caregiver_id`
  directly will silently fail — must use the assignment RPC. (Learned this session.)
- **Non-transactional assignment paths**: avoid the delete-then-insert lockout class of
  bug (seen in EditUser). Assignment changes should be safe under partial failure.
- **`assign_caregiver_to_shift()` refuses completed/cancelled shifts** — fine for live
  scheduling; don't route historical/backfill through it.
- **Office-scoping the tables changes RLS on the operational core** — regression-test
  existing scheduling + the demo after Phase 0, like M-Office did.
- **Eligibility must be server-side** — a client-side-only filter is not a safety boundary
  (the 3A lesson); the engine belongs in the DB so every caller is bound by it.
