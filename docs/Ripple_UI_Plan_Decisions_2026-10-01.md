# Ripple UI Plan — Owner Decisions (Oct 1, 2026)

> Answers to the open questions and conflicts in `docs/ripple-ui-implementation-plan.md` §7.
> **Authoritative.** Where this conflicts with the schema plan, the architecture doc or the UI
> plan, this file wins. Recorded by the project owner on 2026-10-01.

## Environment (R13) — corrected

- `rgeldgztadebgvrdhaqa` is the **DEV project**, not production. No production project exists
  yet; no real clients or real data have been entered or tested.
- Phase A–D migrations, RPCs and all acceptance tests run on this dev project, with disposable
  fixtures and verified teardown as before.
- A production project is created later, before any real Ripple data. Deferred.
- Fix the stale "production database" wording in `docs/m1-security-gate-plan.md` (and anywhere
  else it appears).

## Approved — as recommended in the UI plan

| # | Decision |
|---|---|
| R4 / Q2 | New `care_plans` table (plan of service). `client_orders` unchanged. Add nullable `client_orders.care_plan_id` (and optionally `order_services.service_authorization_id`, display only). |
| R2 | Office-scoped mapping `care_type_code → service_type (cls / respite / …)`, e.g. `office_service_types`. Not a column on global `care_types`. |
| R3 | Extend `caregiver_certifications` additively (`credential_type_id` → new agency-scoped `credential_types`, `effective_date`, `entered_by`). Keep the existing expired/unverified rule. Only the new "required credential missing" check goes behind the flag. Manual entry sets `is_verified = true`. |
| R1 | Group session = one shift per client in the same slot. Staff:client ratio is a note header field. No `shift_clients` junction. |
| R7 | Use the live M-Office RLS predicate (`NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()`), not the schema plan's draft predicate. Update the schema plan. |
| R8 / Q1 | `compliance_enforcement_enabled` = column on `virtual_office`, default false, evaluated against the shift's office. Only `agency_admin` and `system_admin` can change it. |
| Q3 | Separate per-office module flag (e.g. `virtual_office.care_plan_module_enabled`, default false) for menus and dashboard visibility, independent of enforcement. |
| R5 | Caregiver note screen may show clinical content, scoped: own assigned shifts only, this_agency objectives + Instructions for Staff + measures only; no needs, diagnoses or MichiCANS. One SECURITY DEFINER read (`get_progress_note_for_caregiver`). No AI provider involved. |
| R9 | V1 dashboard shows computed status only. Sending notifications (supervisor + caregiver) is a later phase. |
| R6 | Caregiver-safe `detail` for compliance codes in `check_caregiver_shifts_eligibility`. |
| Q4 | Do **not** relabel the existing "Care Plan" menu. New menu item: **"Client Care Plans (IPOS)"**, visible only where the module flag is on. |
| Q5 | Print a wet-signature line on every note until e-signature is confirmed. Signing in-app = typed name + timestamp. |
| Q6 | No client/family view in V1. |
| Q7 | Add `client_documents` doc_type `safety_behavior_plan` with a "not applicable" status. |
| Q8 | Onboarding item "Training forms" is complete when ≥ 1 caregiver is trained on the current `training_version`. Per-caregiver gating stays in the eligibility engine. |
| Q9 | Caregiver records the client's arrival time on the note. Late threshold: 5 minutes. Late = first 15-minute unit not billed. |
| Q10 | Reviewers cannot edit a submitted note; they return it to the caregiver. |
| Q13 | Form Templates V1 = constrained edit (labels, help/static text, options, required, order, add/remove `field_value` fields, billing-footer fields). Publish: `agency_admin` + the office's `manager`. |
| Q14 | Server-side template drafts: add `status draft | published` to `form_template_versions`. No localStorage drafts. |
| Q15 | When an office shell and an agency-wide shell of the same kind exist, the office shell wins. |
| Q16 | Expiry thresholds fixed: yellow ≤ 60 days, red ≤ 30 days, ★ overdue. |
| Q17 | Bren and Lauren = `manager`. `hr_staff` enters credentials and training forms. Managers can do everything HR can, and override HR entries. |
| R10–R12, R14 | As recommended in the UI plan. |

Optional slices: S0b (`/schedule` role guard) is **approved** as part of the security fix.
S4b and S5b stay optional for later.

## Still open — asked to Ripple (Bren / Lauren)

| # | Question | Default until answered |
|---|---|---|
| Q11 | Billing week: Monday–Sunday, or ISK's billing week? | Monday–Sunday, as an office setting so it can change. |
| Q12 | Weekly Billing: review each note one by one, or bulk-approve clean rows? | Build per-note review; add bulk-approve of clean rows as a second button. |
