# Ripple Effects — UI Implementation Plan

> **Status: PLAN ONLY. Nothing has been built.** Companion to
> `Ripple_Effects_Care_Plan_and_Authorization_Module_Architecture.md` (the *why*; §12 is
> authoritative) and `Ripple_Effects_Care_Plan_and_Authorization_Schema_and_Migration_Plan.md`
> (the *what*, backend Phases A–D). This document is the *how* for the UI. Per schema plan
> §10, **no UI slice starts until Phase D (the two done-definition tests) has passed.**
>
> **Scope (owner, Oct 1 2026):** the module is approved. Its only change to scheduling is the
> additive hard rules in `check_assignment_eligibility` behind a per-office
> `compliance_enforcement_enabled` flag (default false), per schema plan §7. Everything else in
> scheduling is preserved exactly. Smart Scheduling AI stays out of scope. No AI provider is
> involved anywhere in this module. Progress notes, IPOS content and authorizations must never
> enter the knowledge/RAG pipeline.
>
> **Build target:** CareMuch's existing components and look: `AppLayout` for staff, and
> `CaregiverAppShell` for caregivers. Also shadcn `ui/*`, `StatCard`, the navy theme and the
> sans-serif type. `docs/design/ripple-console-prototype-v9.html` is a UX sketch, not the build
> target. Its teal/serif theme, dark mode, office picker and "Client login" toggle are not built.

Grounded in a read of the current working tree on branch `phase-3`, including the uncommitted
caregiver app shell. File references are `path:line` against that tree.

> **UPDATE (Oct 4, 2026) — owner decisions applied.** Every R and Q in §7 is now resolved, except
> Q11 and Q12, which are open with Ripple and built with defaults. The resolution table is §7.0;
> the authoritative source is `docs/Ripple_UI_Plan_Decisions_2026-10-01.md`.
> - **Route guards already exist:** `RequireRole` + `src/lib/roleHome.ts` shipped in commit
>   `419fed0` (security batch M-SEC-4). Every staff route, **including `/schedule` (S0b)**,
>   `/dashboard` and `/caregivers`, is guarded, and CLAUDE.md rule 15 requires it for every new
>   route. S0's guard items are therefore **done**; new routes reuse the component.
> - **Phase A schema** is drafted (`supabase/migrations/20261006120000…120700`, not pushed). See the
>   schema plan §2.1 (security baseline) and §13 (conflicts resolved).

---

## 0. What the code actually has (facts the plan depends on)

| Area | Reality today | Consequence for this plan |
|---|---|---|
| Routing | *(Oct 1)* `src/App.tsx` was a flat route list with no guard components. **Since `419fed0` (Oct 4):** every staff/admin route is wrapped in `RequireRole` (`src/components/auth/RequireRole.tsx`, role sets in `src/lib/roleHome.ts`), and `safeNextPath` hardens `?next=`. | New screens reuse `RequireRole` (rule 15). |
| Menu | DB-driven: `system_modules` ⨝ `role_permissions` through `usePermissions()` (`src/hooks/usePermissions.ts`), plus the hard-coded `moduleRouteMap` (lines 61-97). Presentation overrides live in `AppLayout.tsx:57-131`. **`role_permissions` is keyed by `role_code` only**, so it is global across agencies and offices. | A new menu item needs a seed migration plus code, and it appears for *every* agency's managers, Kind Care included. Gating is needed (§3.4, Q3). |
| Office context in UI | None: no office switcher and no current-office hook. Generated `types.ts` is **stale**: it lacks `profiles.virtual_office_id`/`office_restricted`, `shifts.virtual_office_id`, `client_orders.virtual_office_id`, `check_assignment_eligibility_bulk` and `generate_order_number`. | Slice 0 regenerates types. Pages that need an office choice (Weekly Billing) add a page-level office select, following the `CaregiverApprovals.tsx:237` pattern. |
| "Care Plan" today | Nav label "Care Plan" (`AppLayout` `LABEL_OVERRIDES`) points to `/order-management`. The data is `client_orders` → `order_services` → pre-generated `shifts`. That is a **recurring service order / shift generator**: several can be active per client at once (e.g. Betty Baker has ORD-0051, 0042 and 0039). It has no versioning, goals or units. Wizard edits delete and recreate future unassigned shifts (`OrderWizardDialog.tsx:166-235`). The client portal creates orders by a second path (`client-dashboard/OrdersManagement.tsx:323-391`). | It is *not* an IPOS and can't become one without breaking its semantics. See §2. |
| Shifts | One `client_id` (NOT NULL) and one `care_type_code` per shift. `care_types` is **global**, with no agency, service type (CLS/Respite), unit or billing code. | Group sessions and the shift→service-type mapping are open backend questions (§7 R1, R2). |
| Eligibility | `check_assignment_eligibility(_shift_id, _caregiver_id) → jsonb {eligible, auto_approvable, hard[], soft[], advisory[], weekly_hours, projected_weekly_hours}`. Each issue is `{code, label, detail}`. Bulk and caregiver-side variants loop it. `EligibilityReport.tsx` renders server `label`/`detail` directly, with **no code→label map**, so new codes render without code changes. Its `blockers` list merges hard and soft under one red "Blocked" badge, and it uses `key={b.code}`. | Screen 4 needs very little code (§1.4). |
| Credentials | `caregiver_certifications` has free-text `certification_name`, `expiry_date` and `is_verified`, and no agency/office/type/required columns. **No UI writes it.** The engine *already* hard-blocks on any expired or unverified row (`20260915215024_…sql:103-116`). | **Resolved (R3):** extend `caregiver_certifications` (`credential_type_id` → agency `credential_types`, `effective_date`, `entered_by`); no `caregiver_credentials`. Manual entry sets `is_verified = true`. |
| Caregiver app | `CaregiverAppShell` has bottom tabs Today / Schedule / Shifts / Profile. `CaregiverToday` computes live/done/upcoming per shift. `ShiftDetailsDialog` is read-only with an optional `onAssign`. There is no clock-in UI, and no app path writes `time_entries`. The caregiver PHI rule applies: client data comes only through `get_caregiver_visible_clients()` (name/address/phone). | The progress-note entry point fits on the Today card and in `ShiftDetailsDialog` (§1.3). The PHI review is a gate (§7 R5). |
| Print / PDF | No `window.print`, `@media print` or `print:` classes anywhere. `jspdf` is used once (`ScreeningResultDialog.tsx`). | Printing is new work (§1.3). Use browser print plus print CSS, not jspdf layouts. |
| Responsive | `AppLayout`'s sidebar is a fixed `w-64` aside. `isSidebarOpen` defaults to `true` (`AppLayout.tsx:41`), so on mobile it starts open over content with no scrim. Most staff tables overflow at 390px. | §5. |

---

## 1. Screen map

Notation: **R** = read, **W** = write. Every table read goes through RLS, which is the §2 office
shape from the schema plan (see the §7 R7 correction). RPC names in *italics* are not named in
the schema plan. They are **gaps to add to Phase B** (collected in §4.2), and the names are
provisional.

### Shared building blocks (new, used by several screens)

| Component | Purpose | Used by |
|---|---|---|
| `components/compliance/TemplateFormRenderer.tsx` | Renders and edits one Layer-B instance from its own `field_snapshot`. It never reads the live template. It writes `spine_column` fields to columns, `field_value` fields to `field_values`, shows `static_text`, and leaves `child_rows` to dedicated editors. This is the one piece that makes "nothing hard-coded" true. | IPOS, Authorization, intake docs, In-service, Training form, note header |
| `ProvenanceBadge.tsx` | Read-only "built from IPOS template v4 · filled for this client". **Not a link** (arch §9.2.1). | Every Layer-B section |
| `ExpiryPill.tsx` | Expiry status: ★ overdue, red ≤30 days, yellow ≤60 days, ok. Expiry dates go through `parseShiftDate` (`src/lib/shiftDate.ts`) to avoid the known-issues §10 date-only off-by-one. | Dashboard, Caregiver profile, IPOS authorizations |
| `UnitsBar.tsx` | Units authorized / used / remaining, shown as units **and** hours (`unit_minutes`). **No dollars** (Bren: units only). | IPOS services table, Dashboard, Weekly Billing |
| `RequireRole.tsx` | Route guard (§3.3). | All new routes |
| `print/printLayout.css` + `PrintableProgressNote.tsx` | Paper layout of Ripple's note. | Progress notes, Weekly Billing (optional) |

### 1.1 Dashboard (Lauren's three-panel command center)

| | |
|---|---|
| Current | `/dashboard` → `src/pages/Dashboard.tsx` (562 lines). It has StatCard KPIs, two recharts charts, Quick Actions, Urgent Care Requests and a "Needs Your Attention" panel (lines 526-555). That panel already includes an expiring-certifications item from `caregiver_certifications` (line 174) that links to `/caregivers`. |
| Extend / new | **Extend.** Add a "Compliance" section *below* the existing content. It renders only when the user's scope includes a compliance-enabled office (§3.4), so Kind Care's dashboard is unchanged. Nothing existing is removed or reordered. |
| Components reused | `AppLayout`, `StatCard`, `Card`, `Badge`, the existing attention-row style (left border by severity), plus `ExpiryPill` and `UnitsBar`. |
| New pieces | `components/dashboard/compliance/CompliancePanels.tsx` with four KPI tiles (Caregivers 100% ready, Overdue items, **Units** at risk, Clients pending documentation) and three panels: ① Caregivers (training deadlines; background checks), ② Clients (missing documentation; authorization expirations with units at risk, shown as a *bookable-hours* prompt per arch §9.1), ③ Scheduling (progress notes overdue; missing coverage). |
| Row actions | Each row deep-links to the record, not to new logic. Credential → `/caregivers/:id?tab=credentials`. Doc/auth → `/clients/:id/care-plan?tab=ipos`. Overdue note → `…?tab=notes&note=:id`. Missing coverage → `/schedule?tab=unassigned` (existing). |
| New routes | none |
| Reads | `caregiver_credentials` (or the extended `caregiver_certifications`, R3) + `credential_types`; `care_plans` (`training_version`) vs `plan_training_records`; `service_authorizations` (`expiration_date`, `units_available`); `client_documents`; `progress_notes` (status, `service_date`); `shifts` (existing unassigned query). |
| Computation | The architecture says the dashboard "visualizes; it does not compute" (arch §2.6). Readiness %, onboarding status, units-at-risk and note-overdue logic therefore come from the backend: *`get_compliance_dashboard()`* (SECURITY INVOKER so RLS scopes it, or a view), *`get_client_onboarding_status(_client_ids uuid[])`*, and *`get_units_at_risk()`*. **None of these is in Phase B today** (§4.2). |
| Writes | none |
| Also fix here | ~~Add the missing staff role guard~~ **Done** in `419fed0` (`/dashboard` is `RequireRole allow={STAFF}`). |

### 1.2 Client Care Plan (IPOS / Goals / Progress notes / Scheduling + 8-item onboarding)

| | |
|---|---|
| Current | **No client detail route exists.** Client detail is the read-only dialog in `Clients.tsx:1076-1174`. `/order-management` ("Care Plan") is the service-order list (see §2). |
| Extend / new | **New page**, plus two small extensions: (a) a list `/care-plans`, one row per client in a compliance-enabled office, with plan version/status, onboarding x/8, next authorization expiry and next review; (b) a "Care plan" icon on `/clients` rows and an "Open care plan" link in the Client Details dialog. Both are additive and only visible for compliance-enabled offices. |
| New routes | `/care-plans` (list). `/clients/:clientId/care-plan?tab=ipos\|goals\|notes\|scheduling&version=N&note=:id`. The page is keyed by client because a client has many plan versions, and `version` selects a superseded one read-only. Optional `/clients/:clientId/care-plan/print/:noteId` (no AppLayout, print CSS). |
| Layout | `AppLayout` with a page header (client name, active plan "IPOS v2 · annual · effective–expires", buttons *Edit IPOS*, *Renew*). On the left is a sticky **record spine** card (`Card`, collapses to an `Accordion` under `lg`) holding plan documents plus the **onboarding checklist**. Main area is shadcn `Tabs`. |
| Onboarding checklist (8, Bren §12) | Server-computed by *`get_client_onboarding_status`*; the UI only renders it. Each item shows ok / missing / n/a and a link to its tab. ① IPOS: an `active` `care_plans` row. ② Assessment: `client_documents` doc_type `assessment`, current and `complete`. ③ In-service form signed: `plan_inservice_forms` at the current `training_version` with `signed_at`. ④ Client forms, "n of 5": consent, insurance, emergency_contacts, allergies, release_of_information. ⑤ Safety or behavior plan (if applicable): `client_documents` doc_type `safety_behavior_plan`, `complete` **or `not_applicable`** (Q7, resolved). ⑥ Training forms: complete when **≥ 1 caregiver** has a `plan_training_records` row at the current `training_version`; per-caregiver gating stays in the eligibility engine (Q8, resolved). ⑦ Authorization: an active `service_authorizations` row covering today. ⑧ CLS progress note set up: every `this_agency` CLS objective has ≥1 active `objective_measures` and a current Progress Note shell exists. |
| **IPOS tab** | `ProvenanceBadge`. **Authorizations** card (this agency, from KARE) with a FIFO "draws first" marker on the oldest valid authorization. **Services** table (`Table`): Service · Authorized · Used · Remaining (`UnitsBar`) · At-risk · Expiry (`ExpiryPill`). Clicking a row goes to the Goals tab filtered to that service. **Other providers — reference only**: a `Collapsible` list of `care_plan_external_services`, never shown in the units table. Then the person-centered summary (`field_values` via `TemplateFormRenderer`), MichiCANS DSM recommendations, needs (MichiCANS / other), treatment-needs grid with linked objectives, natural supports, attendees, review schedule, and intake documents (own track; each opens its shell in a `Sheet`). *Add authorization* opens a `Sheet` with the Authorization shell (manual adapter, V1). |
| **Goals tab** | Two columns. Left: goals in `seq` order **grouped by the objectives' `service_type`** (generic labels from data). Each objective shows letter, text, service chip and "N data questions". **Select-in-place**: clicking highlights the item and does not collapse the others. The list is followed by "Respite: no goals" and "Other providers' objectives: reference". Right (sticky): Instructions for Staff (read-only on the note), the data questions from `objective_measures` (`Badge` per measure kind), *Add question from library* (`Command` picker over `measure_types`), *Edit*, and recent visits from `progress_note_entries`. **Confirm dialog:** editing goals, objectives or Instructions for Staff bumps `training_version` (schema §4) and invalidates every caregiver's training for this client. The UI warns "This will require retraining N caregivers before they can be scheduled (when enforcement is on)". Editing measures does **not** bump it, so no warning. |
| **Progress notes tab** (staff side) | Left: visit/note list (date, caregiver, CLS/Respite, status `draft → submitted → reviewed → billed`, overdue flag, late-arrival flag). Right: read-only note viewer (`PrintableProgressNote` in screen mode). Actions for status `submitted`: *Review & approve* and *Return to caregiver*. For every status: *Print / save as PDF*. Staff do **not** author caregiver notes here (the prototype shows Sign & submit on the staff page, which is not built). |
| **Scheduling tab** | **Summary only; it never assigns by itself** (arch §7, §9.2.6). It has three parts. (1) "This client's shifts": `shifts` where `client_id` = client in a date window, read-only rows with note status. Unassigned rows show **Assign** and **Smart assign**, which open the *existing* `AssignShiftDialog` / `SmartAssignSheet` components with that shift, so the same engine and RPCs apply. (2) "Who can deliver this plan": caregivers with training status at the current `training_version` and credential readiness. Labelled *training status*, not *eligible*. The filter defaults to "Trained / effective". The engine stays the only authority on eligibility, so this list never claims assignability. (3) Recurring service schedules (`client_orders` for this client, §2) with *Open in Service Schedules* and *Open full Schedule Management →* (`/schedule?tab=clients`). The in-service and training-form entry `Sheet`s also start here, since one training form covers many caregivers. |
| Reads | `clients` (staff RLS), `care_plans` + all children, `measure_types`, `objective_measures`, `service_authorizations`, `care_plan_external_services`, `client_documents`, `plan_inservice_forms`, `plan_training_forms`/`_records`, `progress_notes` + `_entries`, `shifts`, `shift_assignments`, `client_orders`, `form_templates`/`_versions` (to start a new instance only). |
| Writes (RPC) | Plan create/renew (*`create_care_plan`*, *`renew_care_plan`*); goals/objectives edits through *`upsert_care_plan_goals`*, because the `training_version` bump must be server-side; `set_objective_measures`; authorization create/update (*`upsert_service_authorization`*, manual adapter); *`upsert_client_document`*; in-service and training-form entry (*`record_plan_inservice`*, *`record_plan_training`*); `review_progress_note`; *`return_progress_note`*; `upgrade_instance_template` (explicit, confirm dialog). Narrative, needs, DSM, supports and attendees may use direct RLS writes, or the same RPC family (Phase B decides; the UI follows). |

### 1.3 CLS + Respite progress notes: caregiver phone app, review, print/PDF

| | |
|---|---|
| Current | `CaregiverToday.tsx` (today's shift cards with computed live/done/upcoming), `CaregiverSchedule.tsx` (Upcoming / This Week / History), `ShiftDetailsDialog.tsx` (read-only; `onAssign` optional). No note or visit capture exists. |
| Extend / new | **Extend** `ShiftDetailsDialog` with an optional `onOpenNote?: () => void` prop that renders a footer button. It follows the existing `onAssign` gating, so staff callers are unaffected. **Extend** Today shift cards (live/done) and History rows with a "Progress note" button and a status chip (Not started / Draft / Submitted / Returned / Overdue). **Extend** Today with a "Notes due" card (drafts and returned notes, plus notes past the day-after deadline). **New page** for the note itself. It is full-page because the forms are long. |
| New routes | `/caregiver-notes/:shiftId` (inside `CaregiverAppShell`, no new bottom tab, back arrow). |
| Caregiver flow | Open → *`get_or_create_progress_note_for_shift`* (idempotent wrapper over `create_progress_note_for_shift`; returns the existing note). The **header** has client first name + last initial, date, scheduled time (read-only), **client arrival time** (time input, defaults to scheduled start; drives the late-arrival rule), end time, staff:client ratio and location. The **CLS body** has one `Card` per objective, in goal order: goal heading, objective, service chip, *Instructions for Staff* (`Collapsible`, read-only), **Notes** (`Textarea`, "include reinforcers"), and **Data** with one input per measure kind. Mapping: `yes_no_na` → `ToggleGroup`; `prompt_level` → `ToggleGroup`; `graded_steps` → `Checkbox` list; `tally` → stepper with total; `trials` → n rows of `ToggleGroup` + short `Input`; `short_answer` → `Input`; `narrative` → `Textarea`; `staff_note` → `Alert` (display only). The **Respite body** is one "Session narrative" `Textarea` (required at submit). The footer has *Save draft* (autosave on blur) and *Sign & submit*: typed name plus timestamp, an e-signature placeholder until Ripple confirms (arch §12). Submit is blocked client-side, and server-side by `submit_progress_note`, if any `yes_no_na` is unanswered or a respite narrative is missing. After submit the note is read-only; a returned note reopens. |
| Staff review | In the Client Care Plan → Progress notes tab (§1.2), and in Weekly Billing (§1.6). |
| Print / PDF | `PrintableProgressNote` renders Ripple's paper layout: header, objective blocks, "For billing only" footer (case number, units scheduled, units billed, biller), and a blank wet-signature line. The print route has no AppLayout, `@media print` CSS and a *Print / save as PDF* button that calls `window.print()`. **Staff only.** Caregivers do not print. Electronic archiving is a later phase. |
| Reads | **Caregivers cannot read `care_plan_*` / `objective_measures` / notes tables directly** (schema §2.1: no caregiver table access). The note page uses one caregiver-scoped SECURITY DEFINER read, `get_progress_note_for_caregiver(_shift_id)` (**R5 resolved**, now in Phase B). It returns the header, this_agency objectives, Instructions for Staff and active measures, **only** for shifts assigned to the caller. It never returns needs, diagnoses or MichiCANS. Same pattern as `get_caregiver_visible_clients()`. |
| Writes | **RPC only:** `save_progress_note_draft` (header incl. **client arrival time**, Q9; entries' `notes_text`, `data`) and `submit_progress_note` (typed-name signature, Q5), both only while the note is `draft` or `returned` (Q10). There is no caregiver table policy. |
| Not built | Clock-in / EVV (future phase per caregiver-app-design §3.8; arrival time comes from the note). "Additional observation" (dropped, arch §12). A combined CLS + respite note (never combined). |

### 1.4 Scheduling: new blocking reasons in EligibilityReport

| | |
|---|---|
| Current | `EligibilityReport.tsx` is used by `AssignShiftDialog` (bulk RPC) and `ShiftTrades` (single). `match-caregiver` drops hard-blocked candidates for Smart Assign / AutoFill. Caregiver `AvailableShifts` shows "Not eligible" reasons via `check_caregiver_shifts_eligibility`. |
| What changes in the backend | Phase C appends four rules (authorization active, units remaining, trained on the current `training_version`, required credentials current). With the office flag **false** they arrive in `advisory[]`; with it **true**, in `hard[]`. The return shape is unchanged. |
| What changes in UI (minimal, additive) | (1) **Nothing is required to display them.** EligibilityReport renders the server's `label`/`detail`. Flag-false issues show under the existing "Review" badge, and flag-true ones under "Blocked", with Confirm already disabled on hard issues (`AssignShiftDialog.tsx:421`). (2) Change `key={b.code}` to `key={`${b.code}-${i}`}`, a one-line collision fix. (3) Optional `fixHref` per compliance code, resolved by a small client-side map: `authorization_*` → client care plan IPOS tab; `training_version` → client Scheduling tab (record training); `credential_*` → caregiver profile. Rendered as a "Fix →" link inside the existing row. No change to assign behavior. (4) Exact codes and labels come from Phase C. The UI must not hard-code label text. |
| Not changed | Soft-vs-hard badge wording, override flow, AutoFill commit path, `match-caregiver` scoring, Schedule views, `shiftEligibility.ts` local fallback. The fallback lacks the new rules, but final enforcement is server-side in `assign_caregiver_to_shift`, so there is no bypass. An existing display bug is **not** fixed under this scope: soft issues wear the "Blocked" badge. It is logged as optional slice S4b (§6) and needs owner approval. |
| Caregiver side | When the flag is true, a caregiver's Available Shifts will show compliance reasons. The server `detail` for authorization/units codes would expose a client's authorization units to a caregiver, so **Phase C must emit caregiver-safe `detail`** (e.g. "This shift can't be booked yet. Your office will contact you") from `check_caregiver_shifts_eligibility`, or the UI must suppress `detail` for those codes. Recommend the server-side fix (R6). |
| Flag UI | New **Compliance** card in `VirtualOfficeConfig` (alongside `SchedulingOverridesCard`, `/virtual-offices/:id`). It has two switches: `care_plan_module_enabled` (menus/dashboard, Q3) and `compliance_enforcement_enabled`. The enforcement switch carries an explicit warning ("When on, assignments for this office are hard-blocked without an active authorization, remaining units, current-IPOS training and current credentials") and a readiness summary ("12 of 14 caregivers ready · 9 of 11 clients have active authorizations"), so it is not flipped blind. **Edit rights: `agency_admin` and `system_admin` only** (Q1, resolved). The server enforces this with `trg_guard_virtual_office_flags`, because the existing `virtual_office` policy lets any staff role update the row. The UI disables the switches for other roles. |
| Reads/writes | R `check_assignment_eligibility[_bulk]`, `check_caregiver_shifts_eligibility` (unchanged signatures). W `virtual_office.compliance_enforcement_enabled` / `care_plan_module_enabled` (direct update under the existing policy, column-guarded by the trigger). |

### 1.5 Caregiver profile page (background checks, trainings, per-client training)

| | |
|---|---|
| Current | **No caregiver profile page.** `/caregivers` (`Caregivers.tsx`, 1175 lines, **no role guard**: screen 79 shows a caregiver opening the full roster) has a small Details dialog with skills only. Certifications are shown nowhere in staff UI. |
| Extend / new | **New page** `/caregivers/:caregiverId` (wrapped in `RequireRole allow={STAFF}`). **Extend** `/caregivers` with an "Open profile" icon per row and a link in the Details dialog. The existing dialog, edit dialog and `AvailabilityDialog` stay untouched. (`/caregivers` itself is already guarded since `419fed0`.) |
| Layout | `AppLayout`. Header: name, employment type, status, "Ready / N items need attention" pill. `Tabs`: **Overview** (existing fields, read-only, with an *Edit* button that opens the existing edit dialog); **Background checks** (6 rows from `credential_types` category `background_check`); **Trainings** (annual_online / annual / in_person_recert), both as Type · Effective · Expires (`ExpiryPill`) · Verified · Entered by tables with *Add / Renew* in a `Sheet`; **Training for clients** (one row per client in scope: client, current IPOS `training_version`, trained-on version, trainer, signed date, status Signed / Retraining needed / Not trained. A "Record training" shortcut opens the training-form `Sheet` pre-filled with this caregiver and client); **Availability** (summary plus the existing `AvailabilityDialog`). |
| Reads | `caregivers`, `caregiver_skills`, `credential_types`, credentials table (R3), `plan_training_records` ⨝ `care_plans` (current `training_version`), `clients` (names; staff RLS). |
| Writes | `upsert_caregiver_credential` (manual V1; writes `caregiver_certifications` with `credential_type_id`, `entered_by`, and `is_verified=true`, so the existing `certification_unverified` rule doesn't block a staff-entered row, R3); `record_plan_training`. Q17: `hr_staff` may enter; managers may do everything HR can and override HR entries. |
| Caregiver self-view (optional, later) | A read-only "My credentials" section in `/caregiver-settings` (the Profile tab), so the caregiver sees what is expiring (arch: both supervisor and caregiver are notified). It needs a caregiver self-read policy on the credentials table, which is not in the schema plan. Slice S5b. |

### 1.6 Weekly Billing

| | |
|---|---|
| Current | None. Billing is a spreadsheet today (Bren and Lauren). |
| Extend / new | **New page** `/billing/weekly` (Operations menu, module `weekly_billing`). |
| Layout | `AppLayout`. Header controls: **office select** (required for agency-wide users, because `billing_batches` is one per office per week; office-restricted users see their own office fixed) and a week picker (‹ Prev, Today, Next ›). The week starts on the office's `virtual_office.billing_week_start` (default Monday; Q11 open with Ripple). KPI `StatCard`s: Visits, Ready to bill, Notes missing/late, Units lost to late arrival. `Table`: Client · Service · Auth # · Visits · Notes (signed / submitted / missing pills) · Units scheduled · Units billable (late-arrival delta) · Review. Each row expands to its notes, each opening the note viewer `Sheet` with *Review & approve* / *Return*. Footer actions: *Build batch* (`build_billing_batch`), *Export for ISK billing* (client-side CSV, following the `HoursDeliveredTab.tsx:174-189` pattern), *Mark batch billed* (`mark_batch_billed`, with a confirm dialog listing note count and units). Batch status `open → reviewed → billed` is shown as a `Badge`. |
| Reads | `progress_notes` (week, office), `service_authorizations`, `shifts` (scheduled visits without a note → "missing"), `billing_batches`, `clients` (names). |
| Writes | `review_progress_note` per note, plus a second button "Approve all clean rows" (`review_progress_notes(_ids uuid[])`): Q12 default until Ripple answers. Also `return_progress_note` (with a reason; reviewers never edit, Q10), `build_billing_batch`, `mark_batch_billed`. |
| Not built | Dollars (units only), 837 EDI, the KARE connector, remittance (`units_claimed`/`units_paid` stay manager-editable on the authorization). |

### 1.7 Form Templates + measure library

| | |
|---|---|
| Current | None. The nearest Configuration pages are Care Services, Categories and Conversation Builder. `FlowBuilder.tsx`'s draft/publish/version UX (`create_flow_draft` / `publish_flow_draft` / `discard_flow_draft`) is the closest existing pattern and should be mirrored in look. |
| Extend / new | **New page** `/form-templates` (Configuration menu, module `form_templates`). |
| Layout | `Tabs`: **Shells** and **Measure library**. *Shells*: `Table` (Shell · Kind · Current version · Records filled per version · Office (agency-wide or office name)); clicking a row opens a detail panel with version history (v1…vN, current marker; old versions "kept, still render") and a field list. Each field shows storage tag (`spine_column` / `child_rows` / `field_value` / `static_text`), required, "shown on progress note", and options. The **editor** composes a new version locally and *Publish vN* calls `publish_template_version`. A spine-column field can be relabeled or reordered but has no delete control, and the server guard rejects drops anyway. *Measure library*: `Table` (Label · Kind · Default options · Used on N objectives · Active) with *New measure* / *Edit* / *Deactivate* in a `Sheet`. No hard delete while in use. |
| V1 scope (Q13, resolved) | Viewer + version history for all shells (seeded in Phase B through `publish_template_version`) + **constrained** edit: labels, help/static text, options lists, required, order, add/remove `field_value` fields, and the progress-note `note_layout` billing-footer fields. **Not V1:** new `child_rows` structures or new shell kinds. **Publish:** `agency_admin` / `system_admin`, or the office's `manager` for that office's shells. Agency-wide shells: agency_admin / system_admin only. |
| Drafts (Q14, resolved) | Server-side: `form_template_versions.status draft\|published` (Phase A), at most one draft per shell. **No localStorage drafts.** Publish flips the draft to published + current. Precedence (Q15): a new instance uses the office's shell when one exists, otherwise the agency-wide shell. |
| Reads | `form_templates`, `form_template_versions`, `form_template_fields`, `measure_types`; record counts per version via *`get_template_usage(_template_id)`* (a count across instance tables, which would otherwise need six queries). |
| Writes | `publish_template_version`; *`upsert_measure_type`* (or direct RLS writes; the library is agency-scoped); *`create_form_template`* (new shell row, constrained kinds). |

### 1.8 Navigation summary (new menu entries)

| Menu group | Label | Route | Module code (seed migration) |
|---|---|---|---|
| Operations | **Client Care Plans (IPOS)** (Q4) | `/care-plans` | `client_care_plans` |
| Operations | Weekly Billing | `/billing/weekly` | `weekly_billing` |
| Configuration | Form Templates | `/form-templates` | `form_templates` |
| (no menu) | Client care plan detail | `/clients/:clientId/care-plan` | covered by `client_care_plans` |
| (no menu) | Caregiver profile | `/caregivers/:caregiverId` | covered by existing `caregivers` |
| (caregiver app, no tab) | Progress note | `/caregiver-notes/:shiftId` | none; caregiver route guard |

**Q3/Q4 (resolved):** the three new items are visible only when one of the user's RLS-visible
offices has `care_plan_module_enabled = true`. The existing "Care Plan" (`/order-management`) label
is **not** changed. Each new route is wrapped in `RequireRole` (rule 15).

Each new menu item needs: a seed migration inserting `system_modules` + `role_permissions` rows (template: `20260902150000_seed_conversation_builder_menu.sql`, `ON CONFLICT DO NOTHING`); a `moduleRouteMap` entry; an `iconMap` entry; `CATEGORY_ITEM_ORDER` placement; and the `App.tsx` route. Known-issues §17 warns that dashboard-authored config is not in migrations, so this **must** be a migration.

---

## 2. Existing Care Plan (`client_orders`) vs the new `care_plans` spine

### 2.1 Why this needs a decision

The schema plan (§4, "verify first") says: if a care-plan table exists, ALTER it; never create a
parallel one. The verification result is that `client_orders` exists, and it is **not** a plan
of service:

| | `client_orders` (today's "Care Plan") | Ripple IPOS (`care_plans`) |
|---|---|---|
| What it records | *When* recurring service happens. Service lines (care type, days, times, frequency) and the shifts they generate. | *What is authorized and why.* Goals, objectives, Instructions for Staff, needs, versions, training gate. Units come from the linked authorizations. |
| Cardinality | Many per client, several active at once | Exactly one `active` per client (partial unique index), the rest superseded |
| Lifecycle | draft / submitted / derived active-completed; archive by `archived_at`; edits regenerate future open shifts | initial / annual / addendum; renewal = new row + supersede; never edited in identity |
| Used by | Kind Care and all agencies; the client portal creates them too | Ripple only (compliance-enabled offices) |

ALTERing `client_orders` into the IPOS would force "one active per client" onto data that
legitimately has several. It would also attach goals and training to an object whose edits
delete shifts, and change a table the owner wants preserved. That would break
existing behavior, which dev rule 8 forbids.

### 2.2 Recommendation: two layers with distinct jobs, one UI concept, no duplicated data

- **`care_plans` (new table, per the schema plan's CREATE path) = the plan of service.** It is
  shown to users as the **Client Care Plan**.
- **`client_orders` stays exactly as is = the service schedule.** It is the recurring pattern that
  generates shifts.
- **Link them, additively:** a nullable `client_orders.care_plan_id uuid REFERENCES care_plans`
  (Phase A amendment, Q2). It is set when a Ripple manager creates a schedule from the care plan's
  Scheduling tab, and stays NULL for every existing and Kind Care order. Optionally also
  `order_services.service_authorization_id`, so a service line can show "draws from #A-3391";
  this is display only, because the engine selects FIFO itself.
- **No field exists in both.** Units live only in `service_authorizations`. Recurrence lives only
  in `order_services`. Goals live only in `care_plan_goals`. This satisfies dev rule 7: two
  systems with different jobs, not one system twice.
- **Naming (Q4, resolved Oct 4): no relabel.** The existing "Care Plan" menu item
  (`/order-management`) keeps its name for every agency, Kind Care included. The new screen's menu
  item is **"Client Care Plans (IPOS)"**, shown only where the office module flag is on (Q3).
- **Owner approval (R4/Q2, Oct 4).** Option B below is approved: a new `care_plans` table plus a
  nullable `client_orders.care_plan_id`. It is in Phase A, M-CP-02, with a same-client guard
  trigger. Optional `order_services.service_authorization_id` is in M-CP-03 and is display only.
- The Client Care Plan's Scheduling tab lists that client's service schedules and opens the
  **existing** `OrderWizardDialog` pre-filled with the client, to create or edit one. No second
  shift generator is built.

### 2.3 Alternatives considered

| Option | Verdict |
|---|---|
| **A. ALTER `client_orders` into the IPOS spine** (schema plan's literal default) | Rejected. It breaks multi-order-per-client data, couples clinical versioning to a destructive shift regenerator, and changes Kind Care's working feature. |
| **B. New `care_plans` + nullable link from `client_orders`** (recommended) | Additive and zero-impact for existing agencies. Each table keeps one job. It needs one Phase A amendment (the link column) and owner sign-off on deviating from "ALTER if exists". |
| **C. 1:1 extension table `client_order_ipos` keyed by `order_id`** | Rejected. It inherits order cardinality, so an IPOS would exist per order rather than per client, and the "one active plan per client" invariant becomes impossible to state. |
| **D. Replace OrderManagement with the new module** | Rejected. It removes working functionality (dev rule 12) and is explicitly outside the owner's scope. |
| **E. No link at all; the two live side by side** | Workable, but the Scheduling tab could then only infer the client's schedules by `client_id`, with no way to say which schedule implements which plan. Acceptable fallback if Q2 is refused. |

---

## 3. Role and office visibility

### 3.1 Roles in the system

`is_agency_staff()` = `system_admin`, `agency_admin`, `manager`, `scheduler`, `hr_staff`.
Non-staff are `caregiver` and `client` (`get_user_role` returns `client`, and `Auth.tsx` routes it
to `/client-dashboard`). Office tiers (M-Office §2.4): system_admin bypass; agency-wide staff
(`office_restricted = false`) see all offices; office-restricted staff see their own office only.
RLS enforces this, and the UI never filters for security.

### 3.2 Visibility matrix (V = view, E = edit/act, — = no access/redirect)

| Screen / action | system_admin | agency_admin | manager | scheduler | hr_staff | caregiver | client |
|---|---|---|---|---|---|---|---|
| Dashboard compliance panels | — | V | V | V (scheduling + authorization panels only) | V (caregiver credentials/training panel only) | — | — |
| `/care-plans` list | — | V | V | — | — | — | — |
| Care plan: IPOS / Goals edit, renew, measures | — | E | E | — | — | — | — |
| Authorizations (units, expiry), outside the care-plan page | — | E | E | V | — | — | — |
| Care plan: intake documents | — | E | E | — | — | — | — |
| In-service / training-form entry (from the caregiver profile or a training screen) | — | E | E | — | E | — | — |
| Care plan: review / return notes, print | — | E | E | — | — | — | — |
| Care plan: Scheduling tab assign buttons | — | E | E | — | — | — | — |

**Role tiers (owner review, Oct 4: minimum necessary; schema plan §2).** The rows above follow the
RLS read tiers:
- **Clinical** (plans and children, notes, client documents, billing batches): manager,
  agency_admin.
- **Authorizations + service types:** manager, agency_admin, scheduler.
- **Training tables:** manager, agency_admin, hr_staff.
- **Shells / measure types:** all staff.

Consequences for the screens:
- **Scheduler:** keeps scheduling through `/schedule` and sees authorization units and expiry, but
  not the IPOS.
- **hr_staff:** enters credentials and training forms (Q17) from the caregiver profile and a
  training screen; it can't open the Client Care Plan page.
- **system_admin:** not in the clinical tier, so it sees no client clinical content.
| Caregiver profile view | V | V | V | V | V | — (own read-only section later, S5b) | — |
| Caregiver credentials entry | E | E | E | — | E | — | — |
| Progress note authoring (`/caregiver-notes/:shiftId`) | — | — | — | — | — | E (own assigned shifts, draft/returned only) | — |
| Weekly Billing | E | E | E | — | — | — | — |
| Form Templates + measure library | E | E | E for their office's shells; V for agency-wide shells (Q13) | — | — | — | — |
| Compliance enforcement + module switches (Virtual Office) | E | E | V | — | — | — | — |

Role mapping (Q17, resolved): Bren and Lauren are `manager`. `hr_staff` enters credentials and
training forms. Managers can do everything HR can and override HR entries. Every "E" above is a
Phase B RPC with a server-side role check; RLS on the new tables is read-only (schema §2.1).

Office scope: an office-restricted manager sees and edits only their office's clients, plans,
notes, credentials and batches (RLS). Agency-wide shells (`virtual_office_id IS NULL`) are
editable only by agency-wide admins. Office-restricted users see them read-only (Q15, shell
precedence). **Client role:** nothing new in V1. The existing `/client-dashboard` "Care Plans" tab
keeps showing `client_orders`. The prototype's "Client login" view (services and hours left) is
deferred (Q6); IPOS content is never exposed to the client portal by this work.

### 3.3 Route guards to add

> **Status Oct 4:** items 1, 3 and 4 below are **done** in `419fed0` (security batch).
> `RequireRole` + `roleHome.ts` exist; `/dashboard`, `/caregivers` and `/schedule` (S0b) are
> guarded. CLAUDE.md rule 15 now makes a guard mandatory on every new route. Remaining: item 2,
> applied as each new route is added, and item 5.

1. New `src/components/auth/RequireRole.tsx`:
   `<RequireRole allow={[…]} redirect="/" shell="staff|caregiver">`. It wraps the existing
   pattern: `getSession` → `/auth`; `rpc('get_user_role')` → allowlist → toast and redirect.
   It renders a skeleton until the role is resolved. **This is UX, not security.** RLS plus the
   SECURITY DEFINER RPC checks are the enforcement.
2. Apply it to every new route: `/care-plans`, `/clients/:id/care-plan` (+print),
   `/caregivers/:id`, `/billing/weekly`, `/form-templates` (staff allowlists per §3.2), and
   `/caregiver-notes/:shiftId` (caregiver only; a staff user is redirected to the care-plan
   notes tab).
3. Apply it to the **touched** existing pages with the observed hole (screen-inventory
   observation 1): `/dashboard` and `/caregivers` (staff only; caregivers → `/caregiver-dashboard`).
4. `/schedule` has the same hole (screen 78) but is a scheduling page. Adding a guard does not change
   scheduling behavior for staff, but under the "preserve scheduling exactly" scope it is listed as
   separate optional slice S0b for owner approval rather than folded in silently.
5. Hide the new nav items from caregivers and clients by not granting `role_permissions` for those
   roles in the seed migration.

### 3.4 The cross-agency menu problem

`role_permissions` is global per role, so a seeded `client_care_plans` module would show for every
manager of every agency, and for Kind Care, which shares agency `56fbfe38` with Ripple. Recommendation
(Q3, **approved Oct 4**; `virtual_office.care_plan_module_enabled` is in Phase A M-CP-01, admin-only):
a per-office **module-enabled** flag distinct from the enforcement flag (Ripple must enter data
*before* enforcement is switched on). For example `virtual_office.care_plan_module_enabled boolean
DEFAULT false`, read by a small `useComplianceOffices()` hook. Menu items and the dashboard section
render only when the user's RLS-visible offices include one with the flag on. The fallback without
a schema change is to show the menus everywhere with an explanatory empty state, which is not
recommended.

---

## 4. Dependencies on backend phases

### 4.1 Mapping (UI work starts only after Phase D passes; schema plan §10)

| UI piece | A (schema) | B (RPCs) | C (eligibility) | D (tests) | Notes |
|---|---|---|---|---|---|
| Slice 0 (types regen, guard, hooks) | ✓ tables exist | — | — | ✓ | Types regen must follow the last Phase A migration. |
| Form Templates viewer + measure library | M-CP-01, M-CP-02 (`measure_types`), M-CP-07 seed | `publish_template_version`, *`upsert_measure_type`*, *`get_template_usage`* | — | test 1 (no-drift) | |
| Caregiver profile + credentials | M-CP-04 (or the extended certs, R3), M-CP-07 seed | *`upsert_caregiver_credential`*, *`record_plan_training`* | — | ✓ | |
| Client Care Plan, IPOS + Goals | M-CP-01/02/03/03b | *`create_care_plan`*/*`renew_care_plan`*, *`upsert_care_plan_goals`*, `set_objective_measures`, *`upsert_service_authorization`*, *`upsert_client_document`*, *`get_client_onboarding_status`*, `upgrade_instance_template` | — | tests 1+2 | Link column `client_orders.care_plan_id` (Q2). |
| Care Plan Scheduling tab | M-CP-02/04 | *`record_plan_inservice`*, *`record_plan_training`* | uses the existing assign RPCs; compliance reasons need C | ✓ | |
| Caregiver progress note | M-CP-03, M-CP-05 trigger | `create_progress_note_for_shift`, `submit_progress_note`, *`get_progress_note_for_caregiver`*, *`save_progress_note_draft`* | — | test 2 (late arrival, per-shift, snapshot) | PHI review gate (R5). |
| Staff note review + print | M-CP-03 | `review_progress_note`, *`return_progress_note`* | — | ✓ | |
| Weekly Billing | M-CP-03 (`billing_batches`) | `build_billing_batch`, `mark_batch_billed`, *`review_progress_notes`* (bulk, optional) | — | test 2 (weekly batch) | |
| EligibilityReport fix-links + key fix | — | — | M-CP-06 (final codes/labels) | regression with flag false/true | |
| Virtual Office compliance switch + readiness | flag column(s) (Q1, Q3) | readiness counts (could reuse *`get_compliance_dashboard`*) | M-CP-06 | rollout regression | |
| Dashboard compliance panels | all | *`get_compliance_dashboard`*, *`get_units_at_risk`*, *`get_client_onboarding_status`* | — | ✓ | The notification engine (arch §2.5/§7) is **not** in Phases A–D (R9). |

### 4.2 Gaps to add to Phase B before it is considered complete (UI-blocking)

> **Status Oct 4:** all seven are now listed in the schema plan's Phase B (§10). Item 2 is settled: caregivers write only through RPCs, with no table policy (schema §2.1). Item 3 is settled: a `returned` status with a reason is in Phase A (Q10).

1. *`get_progress_note_for_caregiver`*: caregiver-scoped read of objectives, instructions and measures for the caller's assigned shift.
2. *`save_progress_note_draft`* (or confirm that the caregiver draft RLS policy covers `progress_note_entries`, which derives scope through a helper; the schema plan only describes the caregiver policy on `progress_notes`).
3. *`return_progress_note`* (the schema says "the manager can return it" but names no path; the status enum has no `returned`, so returning presumably means `submitted → draft` plus a reason, which needs a column or an `events` row).
4. *`upsert_care_plan_goals`*: goals/objectives/instructions edits must go through a server path that applies the `training_version` bump.
5. *`create_care_plan`*, *`renew_care_plan`*, *`upsert_service_authorization`*, *`upsert_client_document`*, *`record_plan_inservice`*, *`record_plan_training`*, *`upsert_caregiver_credential`*: named here only for concreteness. The schema plan lists them generically.
6. Read/compute functions: *`get_client_onboarding_status`*, *`get_compliance_dashboard`*, *`get_units_at_risk`*, *`get_template_usage`*. Each needs the CLAUDE.md #14 REVOKE-before-GRANT treatment if SECURITY DEFINER. Prefer SECURITY INVOKER so RLS scopes them.
7. Caregiver-safe `detail` for the new compliance codes in `check_caregiver_shifts_eligibility` (Phase C, R6).

---

## 5. Mobile overflow: which touched screens to fix in this work

The root cause for every staff screen is shared. `AppLayout`'s sidebar starts **open** on mobile
(`isSidebarOpen` defaults to `true`) with no scrim, and wide `Table`s and fixed-width dialogs
(e.g. `sm:max-w-[600px]` content wider than 390px) force sideways scroll.

| Screen | Fix in this work? | What |
|---|---|---|
| `AppLayout` (all staff pages) | **Yes, Slice 0.** | Default `isSidebarOpen` to `false` below `md`, add a scrim with click-outside close, close on navigation. One file, no behavior change on desktop. |
| New screens (Care Plans list/detail, Caregiver profile, Weekly Billing, Form Templates) | **Yes, built responsive from day one.** | Tables wrapped in `overflow-x-auto` with key columns first; row → card list under `md`; spine → `Accordion`; two-column Goals/Notes → stacked with a `Sheet` for the detail pane. Acceptance: no horizontal page scroll at 390px. |
| Dashboard (`07`, 560px) | **Yes** (we add a section). | The overflow source is the chart/KPI grid; constrain chart containers to `w-full min-w-0`. The new compliance panels stack. |
| Caregivers (`12`–`17`, 1203px) | **Partly.** | Wrap the roster `Table` in `overflow-x-auto` so the *page* no longer scrolls (the table scrolls inside its card). Dialog internals untouched. |
| Clients (`08`–`11`, 1409px) | **Partly.** | Same `overflow-x-auto` wrapper only (we add one icon). The 1296-line monolith is not refactored. |
| Virtual Office config (`51`–`55`, 603px) | **Yes** (we add a card). | Tabs list → scrollable `TabsList`. |
| Schedule, Assign/Smart/AutoFill dialogs (`26`–`40`), OrderManagement (`18`–`25`) | **No.** | Scheduling is preserved exactly, and OrderManagement is unchanged. Logged for a separate responsive pass. |
| Caregiver app (`68`–`76`) | Already fits 390px. | The new note page must too. It is the primary phone surface: large tap targets, sticky Save/Submit footer above the bottom nav, inputs at ≥16px so iOS doesn't zoom. |

---

## 6. Build order: small reviewable slices

Each slice is one PR, reviewed before the next. Each acceptance test runs against the dev data
through real logins (manager, office-restricted manager, scheduler, hr_staff, caregiver),
mirroring the M-Office test discipline, and every slice re-runs the **scheduling no-change check**:
Manual, Smart and Auto Assign for a Kind Care shift still behave identically.

| # | Slice | Contents | Acceptance test |
|---|---|---|---|
| **S0** | Foundations | Regenerate `types.ts`; ~~`RequireRole`~~ (done, `419fed0`); `useComplianceOffices()`; `useCurrentProfile()` (agency, office, restricted); `AppLayout` mobile-sidebar fix; shared `ExpiryPill`, `UnitsBar`, `ProvenanceBadge`; ~~guards on `/dashboard` and `/caregivers`~~ (done, `419fed0`). | `tsc` clean; a caregiver hitting `/dashboard` or `/caregivers` is redirected to `/caregiver-dashboard`; staff unaffected; at 390px the sidebar starts closed on every staff page; existing pages render unchanged at 1440px. |
| ~~S0b~~ | `/schedule` guard | **Done** via `RequireRole` in `419fed0` (approved as part of the security fix). | Verified in the security batch (U1/U6): a caregiver is redirected; staff Schedule unchanged. |
| **S1** | Menu + module gating | Seed migration for 3 modules + `role_permissions` (staff roles only); `moduleRouteMap`/icons/order; module-enabled office gating (Q3); empty-shell routes. | The Ripple-office manager sees the 3 items; a Kind Care-only restricted manager does not; caregiver and client never; `aclexplode`/policy unchanged (data-only migration). |
| **S2** | Form Templates (read) + measure library | Shell list, version history, field viewer with storage tags; measure library CRUD. | Seeded shells listed with correct versions/record counts; an office-restricted manager sees only their office's and agency shells; a new measure appears in the Goals picker (S4); deactivating a used measure is allowed but deleting is not. |
| **S3** | Caregiver profile + credentials | `/caregivers/:id` tabs; credential entry `Sheet`; "Training for clients" read view. | Entering an expiring credential shows the correct ExpiryPill colors at 61/59/29/−1 days (date-only safe); a cross-office caregiver URL returns not-found for a restricted manager; the Kind Care caregiver profile shows no compliance tabs (or empty). |
| **S4** | Client Care Plan, read + IPOS/authorization edit | `/care-plans` list; detail page with spine, onboarding checklist (server-computed), IPOS tab via `TemplateFormRenderer`, authorization `Sheet`, intake documents. | Create a plan from IPOS shell v1 → publish v2 in S2 → open the plan: still renders v1 with badge "v1" (no-drift, UI side). Add an authorization: units show authorized = remaining. Onboarding counts match a hand-computed fixture. A superseded version opens read-only via `?version=`. |
| **S5** | Goals tab + measures + retraining warning | Select-in-place list, objective panel, measure picker, goal/objective editor with the training-version confirm. | Editing an objective's measures doesn't change `training_version`; editing instructions shows the warning and bumps it (verified by query); grouping follows the objective `service_type`; sequence is preserved after edits. |
| S5b *(optional)* | Caregiver self-view of credentials | Read-only section in Profile. | Caregiver sees only their own rows (needs the self-read policy). |
| **S6** | Training workflow | In-service and training-form `Sheet`s on the Scheduling tab; "Who can deliver" list; client schedules list + `OrderWizardDialog` prefill; shift list with existing Assign/Smart buttons. | Renew the plan → every caregiver flips to "Retraining needed"; after in-service + training entry → "Signed". Clicking Assign opens the unchanged `AssignShiftDialog` with that shift. No new assign code path exists (grep). |
| **S7** | Caregiver progress note | `/caregiver-notes/:shiftId` (`RequireRole` caregiver); Today/History buttons + "Notes due"; `ShiftDetailsDialog` `onOpenNote`; client arrival time input (Q9). **PHI scope decided (R5):** own assigned shifts; this_agency objectives + Instructions for Staff + measures; no needs, diagnoses or MichiCANS. | CLS shift → one block per this_agency objective, none for case-management objectives; respite → narrative only and can't be submitted empty; a late arrival records `units_used = scheduled − 1`; after submit it is read-only; a second open doesn't create a second note; another caregiver's shift URL is refused by the RPC; works at 390px. |
| **S8** | Staff review + print | Progress notes tab viewer, review/return, print route. | Submitted → Reviewed; Return → the caregiver can edit again; the print preview matches Ripple's paper layout (header, blocks, billing footer, signature line) with no app chrome; a historical note prints from `measures_snapshot` after the measure was edited. |
| **S9** | Weekly Billing | Page, batch build, export, mark billed. | A week with reviewed + unreviewed + missing notes: the batch picks up only reviewed ones; CSV totals equal the table; mark-billed flips every note to `billed`; an office-restricted user can't build another office's batch. |
| **S10** | Eligibility UI + enforcement switch | `EligibilityReport` key fix + "Fix →" links; Virtual Office Compliance card with readiness; caregiver-safe detail check. | **Flag false:** a Ripple assignment with no authorization shows a "Review" advisory and Confirm stays enabled; Kind Care is identical to before. **Flag true:** the same assignment shows "Blocked" with Fix → to the IPOS tab and Confirm is disabled; Smart Assign omits the caregiver; the caregiver's Available Shifts shows the generic reason with no units/authorization detail. |
| **S11** | Dashboard compliance section | Panels + KPIs + deep links. | Every row links to the correct record and tab; Kind Care-only users see the dashboard exactly as before; the counts equal the RPC output on a seeded fixture. |
| S4b *(optional, owner)* | EligibilityReport soft-vs-hard wording | Soft issues badge "Needs override", not "Blocked". | Display only; the override flow is unchanged. |

Order rationale: configuration catalogs (S2–S3) before instances, so that shells and credential
types exist; the plan (S4–S6) before delivery (S7–S9), because notes need objectives and measures;
enforcement UI (S10) last, right before Ripple flips the flag; dashboard (S11) last because it
reads everything. S7 can run in parallel with S5/S6 once its PHI review clears.

---

## 7. Open questions and risks

### 7.0 Resolution status (owner decisions, Oct 1; applied Oct 4)

| # | Status | Decision |
|---|---|---|
| R1 | Resolved | Group session = one shift per client in the same slot; staff:client ratio is a note header field; no `shift_clients`. |
| R2 | Resolved | Office-scoped `office_service_types` (care_type_code → service_type); nothing added to global `care_types`. In Phase A M-CP-03. |
| R3 | Resolved | Extend `caregiver_certifications` (+ `credential_type_id` → agency `credential_types`, `effective_date`, `entered_by`). The existing expired/unverified rule is unchanged; only "required credential missing" is behind the flag. Manual entry sets `is_verified = true`. |
| R4 | Resolved | New `care_plans` table; `client_orders` unchanged except nullable `care_plan_id`. |
| R5 | Resolved | `get_progress_note_for_caregiver`, SECURITY DEFINER: own assigned shifts only; this_agency objectives + Instructions for Staff + measures; no needs, diagnoses or MichiCANS. No AI provider. |
| R6 | Resolved | Caregiver-safe `detail` for compliance codes in `check_caregiver_shifts_eligibility` (Phase C). |
| R7 | Resolved | Live M-Office predicate in every policy (schema §2). |
| R8 | Resolved | `virtual_office.compliance_enforcement_enabled`, default false, evaluated against the shift's office. |
| R9 | Resolved | V1 dashboard shows computed status only; sending notifications is a later phase. |
| R10 | Resolved (as recommended) | Not built: caregiver sign on the staff page, client view, dollars, "Additional observation". |
| R11 | Resolved (as recommended) | Regenerate types in S0 and after every Phase A migration. |
| R12 | Resolved (as recommended) | Notes only on assigned/delivered shifts. `progress_notes.shift_id` is `ON DELETE RESTRICT`; the order wizard deletes only unassigned shifts. |
| R13 | Resolved | `rgeldgztadebgvrdhaqa` is DEV; fixtures + verified teardown. |
| R14 | Resolved | Guards on `/dashboard`, `/caregivers`, `/schedule` done in `419fed0`. Outbox passwords closed by Issue 2 (`2756b25`) + E5. |
| Q1 | Resolved | Flag on `virtual_office`; only agency_admin / system_admin change it, enforced by a guard trigger (not UI only). |
| Q2 | Resolved | `client_orders.care_plan_id` approved; optional `order_services.service_authorization_id` (display only). |
| Q3 | Resolved | `virtual_office.care_plan_module_enabled`, default false, admin-only, for menus and dashboard. |
| Q4 | Resolved | No relabel. New item "Client Care Plans (IPOS)", visible only where the module flag is on. |
| Q5 | Resolved | Wet-signature line printed on every note; in-app sign = typed name + timestamp. |
| Q6 | Resolved | No client/family access in V1. |
| Q7 | Resolved | `client_documents` doc_type `safety_behavior_plan` with a `not_applicable` status. |
| Q8 | Resolved | "Training forms" complete when ≥ 1 caregiver is trained on the current `training_version`. |
| Q9 | Resolved | Caregiver records the client's arrival time on the note; late > 5 min → first 15-min unit not billed. |
| Q10 | Resolved | Reviewers can't edit a submitted note; they return it (`returned` + reason). |
| Q11 | **Open (Ripple)** | Default: Monday–Sunday, office setting `virtual_office.billing_week_start`. |
| Q12 | **Open (Ripple)** | Default: per-note review + "bulk-approve clean rows" as a second button. |
| Q13 | Resolved | Constrained template edits; publish by agency_admin or the office's manager. |
| Q14 | Resolved | `form_template_versions.status draft\|published`; no localStorage drafts. |
| Q15 | Resolved | The office shell beats the agency-wide shell. |
| Q16 | Resolved | Fixed thresholds: yellow ≤ 60 days, red ≤ 30 days, ★ overdue. |
| Q17 | Resolved | Bren and Lauren = manager; hr_staff enters credentials and training forms; manager can do everything HR can and override it. |
| S0b | Done | `/schedule` guard shipped in `419fed0`. |

The tables below are kept as originally written (Oct 1) for the record.

### 7.1 Conflicts between the docs and the code

| # | Conflict | Recommendation |
|---|---|---|
| **R1** | **Group sessions.** The schema plan creates one note per client on a shift and makes `progress_notes` unique on `(shift_id, client_id)`, but `shifts.client_id` is a single NOT NULL column and every rule, policy and UI assumes one client per shift. | V1: a group session is modeled as one shift per client in the same slot; the staff:client ratio is a note header field. A `shift_clients` junction would be a scheduling change and is out of scope. Owner confirms. |
| **R2** | **Shift → service type.** The rules key on `(client_id, service_type)` and note kind CLS/Respite, but shifts carry only a global `care_type_code`. `care_types` has no agency or service-type column (Ripple's demo uses codes like `CLS0001`). | Phase A needs an agency- or office-scoped mapping (`care_type_code → service_type`), e.g. a small `office_service_types` table, rather than a column on the global `care_types`. Without it, Phase C rule 1 and note kind can't be computed. |
| **R3** | **Credentials duplicate certifications.** `caregiver_certifications` already exists and is already hard-enforced (expired or unverified → hard, for *all* agencies, regardless of the new flag). The schema plan adds `credential_types` + `caregiver_credentials` and also says "extend Rule F's source rather than add a second check". | Decide before Phase A. Recommended: extend `caregiver_certifications` additively (`credential_type_id` → new agency-scoped `credential_types`, `effective_date`, `entered_by`; office via the caregiver) and keep the existing rule. Put only the *new* "required credential missing" check behind the flag. Caveat: entering Ripple background checks as certifications makes the *existing* expired/unverified rule apply to them immediately, flag or not. The UI sets `is_verified=true` on manual entry. Owner/Phase A confirms. |
| **R4** | **`client_orders` vs `care_plans`**: the schema plan's "ALTER if exists" default. | §2: create `care_plans` and link it additively. Needs explicit sign-off as a deviation. |
| **R5** | **PHI on the caregiver phone.** Caregivers today see only name/address/phone (`get_caregiver_visible_clients`). The progress note necessarily shows IPOS objectives and Instructions for Staff, which are clinical content. caregiver-app-design §3.8 already says visit checklists need a PHI review. | Gate S7 on a recorded PHI decision: scope is assigned shifts only, this_agency objectives only, no needs/diagnoses/MichiCANS, served by one SECURITY DEFINER read. No AI provider touches any of it. |
| **R6** | Caregiver-facing eligibility `detail` would reveal authorization units once the flag is true. | Server emits a caregiver-safe detail for compliance codes in `check_caregiver_shifts_eligibility` (Phase C). |
| **R7** | **The schema plan's RLS predicate is not M-Office's.** Schema §2 says "M-Office §2.3 verbatim" but writes `current_virtual_office_id() IS NULL OR …`. M-Office §2.4's live shape is `NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()`, and a NULL row office fails closed for restricted users. The two differ for restricted users on NULL-office rows (e.g. agency-wide shells). | Phase A uses the live M-Office predicate. The UI plan assumes it: agency-wide shells are visible to restricted users only if a separate read clause allows it (Q15). |
| **R8** | **Flag scope.** The owner says per-office; the schema plan says "per-agency (or per-office)". The engine reads config only from `agency` today, and the `virtual_office` override columns exist but are not consumed. | Per-office column on `virtual_office`, evaluated against the shift's office. It is the engine's first office-level setting, so Phase C should test it explicitly. |
| **R9** | **Notification engine** (60/30-day alerts to supervisor and caregiver, units-at-risk) is described in arch §2.5/§7 but is in none of Phases A–D. | The dashboard (S11) shows *computed* status without sending notifications. Sending via `pending_notifications` is a separate later phase. Note that `pending_notifications` is agency-wide by design (M-Office §6.3), while the architecture wants office-scoped alerts. |
| **R10** | **Prototype vs rules:** the prototype shows caregiver Sign & submit on the staff page, a "Client login" view, dollars ("$3,120 at risk"), and "Additional observation" (dropped). | Not built: staff review only, client view deferred, units only, no observations. |
| **R11** | **Stale generated types** (missing office columns and RPCs). | Regenerate in S0 and after every Phase A migration. Remove the existing `as never` casts only where touched. |
| **R12** | **Order wizard edits delete future unassigned shifts.** If a shift is ever pre-created as a note anchor or referenced by an authorization forecast, it could vanish. | Notes are created only for assigned/delivered shifts, so V1 is safe. Phase B's `create_progress_note_for_shift` should refuse unassigned shifts. |
| **R13** | **Environment (resolved by the owner, Oct 1):** `rgeldgztadebgvrdhaqa` is the app's only project and is the **DEV** project; no production project exists yet (see `Ripple_UI_Plan_Decisions_2026-10-01.md`). | Phase A–D migrations and all UI acceptance tests need a non-production target or disposable fixtures with verified teardown. Raise before Phase A. |
| **R14** | **Existing security holes seen on touched screens**: caregivers reach `/dashboard`, `/caregivers` and `/schedule` (no guard; RLS-only); `/notifications-outbox` shows temporary passwords. | Guards for the first two are in S0, `/schedule` is S0b. The outbox is out of scope here and logged for its own fix. |

### 7.2 Open questions for the owner / Ripple

| # | Question |
|---|---|
| Q1 | Where does `compliance_enforcement_enabled` live: a `virtual_office` column (recommended) or an agency setting? Who may flip it (recommended: agency_admin, system_admin)? |
| Q2 | Approve the additive `client_orders.care_plan_id` link (and optionally `order_services.service_authorization_id`)? |
| Q3 | Approve a separate per-office *module-enabled* flag for menu/dashboard visibility, distinct from enforcement? |
| Q4 | Relabel the existing "Care Plan" menu (`/order-management`) to "Service Schedules"? It affects Kind Care users. If not, the new screen is titled "Plan of Service (IPOS)". |
| Q5 | E-signature: typed name + timestamp until Ripple confirms (arch §12). Does Ripple need a printed wet-signature line on every note, or only on request? |
| Q6 | Should clients/families ever see anything (hours remaining, upcoming visits)? Recommended: not in V1. |
| Q7 | Onboarding item 5, "Safety plan or behavior plan (if applicable)", has no table or doc type. Add `client_documents` doc_type `safety_behavior_plan` with a "not applicable" status? |
| Q8 | Onboarding item 6, "Training forms": complete when ≥1 caregiver is trained on the current version, or when every caregiver with upcoming shifts for the client is? |
| Q9 | Who records the client's arrival time for the late-arrival rule: the caregiver on the note (recommended, since there's no clock-in), or the manager at review? Is the 5-minute threshold office-configurable? |
| Q10 | Can a reviewer edit a submitted note's content, or only return it? (Recommended: return only; audit-friendly.) |
| Q11 | Billing week boundary: Monday–Sunday or ISK's week (the prototype shows Mon Sep 22 – Sun Sep 28)? |
| Q12 | Weekly Billing: does Bren review note-by-note, or bulk-approve all clean rows? |
| Q13 | Form Templates V1: is constrained edit enough (labels/options/required/order/narrative fields), or is a full structural builder needed now? Can an office manager (not only agency_admin) publish shells? |
| Q14 | Server-side template drafts (`status draft`), or editor-local drafts until publish? |
| Q15 | Shell precedence: when both an office shell and an agency-wide shell of the same kind exist, which does a new instance use? (Recommended: the office shell wins.) |
| Q16 | Is the 30–60-day ExpiryPill threshold fixed, or per credential type? |
| Q17 | Role mapping for Ripple staff: Bren (program lead, reviews and bills) and Lauren (billing) as `manager`? Does hr_staff enter credentials and training forms? |
